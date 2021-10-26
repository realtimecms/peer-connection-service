const app = require("@live-change/framework").app()
const validators = require("../validation")
const { createTurnConfiguration, releaseTurnConfiguration, turnExpireTime } = require('./turn.js')
const ReactiveDao = require('@live-change/dao')

require('../../i18n/ejs-require.js')
const i18n = require('../../i18n')

const definition = app.createServiceDefinition({
  name: 'peerConnection',
  eventSourcing: true,
  validators
})

const { getAccess, hasRole, checkIfRole, getPublicInfo } =
    require("../access-control-service/access.js")(definition)
const { checkPrivAccess } = require('../messages-service/privAccess.js')(definition)

const PublicSessionInfo = definition.foreignModel('accessControl', 'PublicSessionInfo')

const peerFields = {
  toType: {
    type: String
  },
  toId: {
    type: String
  },
  instance: {
    type: String
  }
}

const Peer = definition.model({
  name: "Peer",
  properties: {
    ...peerFields,
    session: {
      type: PublicSessionInfo
    },
    /*device: {
      type: Device
    }*/
  },
  indexes: {
    byChannel: {
      property: ['toType', 'toId']
    },
    byChannelInstance: {
      property: ['toType', 'toId', 'instance']
    }
  }
})

definition.view({
  name: "peers",
  properties: {
    toType: {
      type: String
    },
    toId: {
      type: String
    }
  },
  returns: {
    type: Array,
    of: {
      type: Peer
    }
  },
  access: (params, { client, visibilityTest }) => {
    if(visibilityTest) return true;
    const { toType, toId } = params
    console.log("CHECK PEERS ACCESS", params, client, visibilityTest)
    return checkIfRole(toType.split('.')[0], toId, ['reader', 'speaker', 'vip', 'moderator', 'owner'],
        { client, visibilityTest })
  },
  async daoPath({ toType, toId }, { client, service }, method) {
    return Peer.indexRangePath('byChannel', [toType, toId])
  }
})

definition.event({
  name: "peerOnline",
  async execute({ toType, toId, instance, session }) {
    const peer = toType + '_' + toId + '_' + session + '_' + instance
    await Peer.create({ id: peer, toType, toId, instance, session })
  }
})
definition.event({
  name: "peerOffline",
  async execute({ toType, toId, instance, session }) {
    const peer = toType + '_' + toId + '_' + session + '_' + instance
    Peer.delete(peer)
  }
})
definition.event({
  name: "allOffline",
  async execute() {
    await app.dao.request(['database', 'query', app.databaseName, `(${
        async (input, output, { table }) => {
          await input.table(table).range({}).onChange(async obj => {
            output.table(table).delete(obj.id)
          })
        }
    })`, { table: Peer.tableName }])
  }
})

definition.trigger({
  name: "sessionPeerOnline",
  properties: {
  },
  async execute(params, context, emit) {
    console.log("PEER OFFLINE PARAMS", params)
    const { session, parameters: [peerId] } = params
    const [toType, toId, publicInfoId, instance] = peerId.split('_')
    const publicInfo = await getPublicInfo(session)
    console.log("PUB INFO", session, "=>", publicInfo)
    if(publicInfoId != publicInfo.id) throw new Error("public session id mismatch")
    if(publicInfo) emit({
      type: 'peerOnline',
      toType, toId, instance, session: publicInfo.id
    })
  }
})
definition.trigger({
  name: "sessionPeerOffline",
  properties: {
  },
  async execute(params, context, emit) {
    console.log("PEER OFFLINE PARAMS", params)
    const { session, parameters: [peerId] } = params
    const [toType, toId, publicInfoId, instance] = peerId.split('_')
    const publicInfo = await getPublicInfo(session)
    console.log("PUB INFO", session, "=>", publicInfo)
    if(publicInfoId != publicInfo.id) throw new Error("public session id mismatch")
    if(publicInfo) emit({
      type: 'peerOffline',
      toType, toId, instance, session: publicInfo.id
    })
  }
})
definition.trigger({
  name: "allOffline",
  properties: {
  },
  async execute({ }, context, emit) {
    emit({
      type: "allOffline"
    })
  }
})


const peerStateFields = {
  audioState: {
    type: String
  },
  videoState: {
    type: String
  }
}

const PeerState = definition.model({
  name: "PeerState",
  properties: {
    ...peerStateFields
  }
})

definition.event({
  name: "peerStateSet",
  async execute({ peer, data }) {
    await PeerState.create({ ...data, id: peer })
  }
})

definition.view({
  name: "peerState",
  properties: {
    peer: {
      type: Peer
    }
  },
  returns: {
    type: PeerState
  },
  access: async ({ peer }, context) => {
    const { client, service, visibilityTest } = context
    if(visibilityTest) return true
    const [toType, toId, toSession] = peer.split('_')
    return toType.split('.')[0] == 'priv'
        ? checkPrivAccess(toId, context)
        : checkIfRole(toType.split('.')[0], toId, ['speaker', 'vip', 'moderator', 'owner'], context)
  },
  async daoPath({ peer }, { client, service }, method) {
    return PeerState.path(peer)
  }
})

definition.action({
  name: "setPeerState",
  properties: {
    peer: {
      type: Peer
    },
    ...peerStateFields
  },
  //queuedBy: (command) => `${command.toType}_${command.toId})`,
  access: async ({ peer }, context) => {
    const { client, service, visibilityTest } = context
    if(visibilityTest) return true
    const [toType, toId, toSession] = peer.split('_')
    const publicSessionInfo = await getPublicInfo(client.sessionId)
    if(publicSessionInfo.id != toSession) return false
    return toType.split('.')[0] == 'priv'
        ? checkPrivAccess(toId, context)
        : checkIfRole(toType.split('.')[0], toId, ['speaker', 'vip', 'moderator', 'owner'], context)
  },
  async execute(props, { client, service }, emit) {
    let data = { }
    for(const key in peerStateFields) {
      data[key] = props[key]
    }
    emit({
      type: 'peerStateSet',
      peer: props.peer,
      data
    })
    return 'ok'
  }
})


const messageFields = {
  to: {
    type: Peer
  },
  from: {
    type: Peer
  },
  type: {
    type: String
  },
  data: {
    type: Object
  }
}

const Message = definition.model({
  name: "Message",
  properties: {
    timestamp: {
      type: Date,
      validation: ['nonEmpty']
    },
    ...messageFields
  },
  indexes: {
    /*byToTimestamp: {
      property: ['to', 'timestamp']
    },*/
  },
  crud: {
    deleteTrigger: true,
    writeOptions: {
      access: (params, {client, service}) => {
        return client.roles.includes('admin')
      }
    }
  }
})

definition.view({
  name: "messages",
  properties: {
    peer: {
      type: Peer
    },
    gt: {
      type: String,
    },
    lt: {
      type: String,
    },
    gte: {
      type: String,
    },
    lte: {
      type: String,
    },
    limit: {
      type: Number
    },
    reverse: {
      type: Boolean
    }
  },
  returns: {
    type: Array,
    of: {
      type: Message
    }
  },
  access: async({ peer }, { client, service, visibilityTest }) => {
    if(visibilityTest) return true
    if(!peer) throw new Error("peer parameter is required")
    const publicSessionInfo = await getPublicInfo(client.sessionId)
    //console.log('MESSAGES ACCESS', peer.split('_'), "[2] == ", publicSessionInfo.id)
    return peer.split('_')[2] == publicSessionInfo.id
  },
  async daoPath({ peer, gt, lt, gte, lte, limit, reverse }, { client, service }, method) {
    const channelId = peer
    if(!Number.isSafeInteger(limit)) limit = 100
    const range = {
      gt: gt ? `${channelId}_${gt.split('_').pop()}` : (gte ? undefined : `${channelId}_`),
      lt: lt ? `${channelId}_${lt.split('_').pop()}` : undefined,
      gte: gte ? `${channelId}_${gte.split('_').pop()}` : undefined,
      lte: lte ? `${channelId}_${lte.split('_').pop()}` : ( lt ? undefined : `${channelId}_\xFF\xFF\xFF\xFF`),
      limit,
      reverse
    }
    const messages = await Message.rangeGet(range)
    console.log("MESSAGES RANGE", JSON.stringify({ peer, gt, lt, gte, lte, limit, reverse }) ,
        "\n  TO", JSON.stringify(range),
        "\n  RESULTS", messages.length, messages.map(m => m.id))

    /* console.log("MESSAGES RANGE", range, "RESULTS", messages.length)*/
    return Message.rangePath(range)
  }
})

let lastMessageTime = new Map()

async function postMessage(props, { client, service }, emit, conversation) {
  console.log("POST MESSAGE", props)
  const channelId = props.to
  let lastTime = lastMessageTime.get(channelId)
  const now = new Date()
  if(lastTime && now.toISOString() <= lastTime.toISOString()) {
    lastTime.setTime(lastTime.getTime() + 1)
  } else {
    lastTime = now
  }
  if(lastTime.getTime() > now.getTime() + 100) { /// Too many messages per second, drop message
    return;
  }
  lastMessageTime.set(channelId, lastTime)
  const message = `${channelId}_${lastTime.toISOString()}`
  let data = {}
  for(const key in messageFields) {
    data[key] = props[key]
  }
  data.timestamp = now
  if(!data.user) {
    const publicInfo = await getPublicInfo(client.sessionId)
    data.session = publicInfo.id
  }
  emit({
    type: "MessageCreated",
    message,
    data
  })
}

definition.action({
  name: "postMessage",
  properties: {
    ...messageFields
  },
  //queuedBy: (command) => `${command.toType}_${command.toId})`,
  access: async ({ from, to }, context) => {
    const { client, service, visibilityTest } = context
    if(visibilityTest) return true
    const [fromType, fromId, fromSession] = from.split('_')
    const [toType, toId, toSession] = to.split('_')
    if(toType != fromType) return false
    if(toId != fromId) return false
    const publicSessionInfo = await getPublicInfo(client.sessionId)
    if(publicSessionInfo.id != fromSession) return false
    return toType.split('.')[0] == 'priv'
        ? checkPrivAccess(toId, context)
        : checkIfRole(toType.split('.')[0], toId, ['speaker', 'vip', 'moderator', 'owner'], context)
  },
  async execute(props, { client, service }, emit) {
    const result = await postMessage(props, { client, service }, emit)
    console.log("MESSAGE POSTED!")
    return result
  }
})

definition.view({
  name: "turnConfiguration",
  properties: {
    peer: {
      type: Peer
    }
  },
  access: async ({ peer }, context) => {
    const { client, service, visibilityTest } = context
    if(visibilityTest) return true
    const [ fromType, fromId, fromSession ] = peer.split('_')
    const publicSessionInfo = await getPublicInfo(client.sessionId)
    console.log("TURN ACCESS PUBLIC SESSION INFO", publicSessionInfo)
    if(publicSessionInfo.id != fromSession) return false
    return fromType.split('.')[0] == 'priv'
        ? checkPrivAccess(fromId, context)
        : checkIfRole(fromType.split('.')[0], fromId, ['speaker', 'vip', 'moderator', 'owner'], context)
  },
  observable({ peer }, context) {
    const observable = new ReactiveDao.ObservableValue()
    let turnWorking = true
    const refreshTurn = async () => {
      if(observable.isDisposed()) {
        turnWorking = false
        return
      }
      try {
        observable.set(await createTurnConfiguration(context))
      } catch(error) {
        observable.error(error)
      }
      const refreshDelay = turnExpireTime * 1000 / 2
      setTimeout(refreshTurn, refreshDelay)
    }
    refreshTurn() // must be async!
    const oldRespawn = observable.respawn
    observable.respawn = () => {
      oldRespawn.call(observable)
      if(!turnWorking) refreshTurn() // must be async!
    }
    return observable
  },
  async get({ peer }, context) {
    return await createTurnConfiguration(context)
  }
})

module.exports = definition

async function start () {
  if(!app.dao) {
    await require('@live-change/server').setupApp({})
    await require('@live-change/elasticsearch-plugin')(app)
  }

  app.processServiceDefinition(definition, [...app.defaultProcessors])
  await app.updateService(definition)//, { force: true })
  const service = await app.startService(definition, { runCommands: true, handleEvents: true })

  /*require("../config/metricsWriter.js")(definition.name, () => ({

  }))*/
}

if (require.main === module) start().catch(error => {
  console.error(error)
  process.exit(1)
})


