const crypto = require('crypto')

const urls = process.env.TURN_URLS.split(';')
const secret = process.env.TURN_SECRET

const turnExpireTime = (+process.env.TURN_EXPIRE) || (60 * 60) // 1 hour for default

function randomHexString(size) {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(size / 2, function(err, res) {
      if (err) return reject(err)
      resolve(res.toString('hex'))
    })
  })
}

async function createTurnConfiguration({ client }) {
  const expire = Date.now() / 1000 + turnExpireTime | 0
  const username = await randomHexString(10)
  const rusername = expire + ':' + username
  const password = crypto
    .createHmac('sha1', secret)
    .update(rusername)
    .digest('base64')
  /// TODO: select nearest servers by geoip
  return {
    urls,
    credentialType: 'password',
    username: rusername,
    credential: password,
    clientIp: client.ip
  }
}

async function releaseTurnConfiguration() {
  /// not used in static shared secret configuration
}

module.exports = { createTurnConfiguration, releaseTurnConfiguration, turnExpireTime }
