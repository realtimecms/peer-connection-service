const crypto = require("crypto")

const config = {
  TURN_URLS: 'turn:turn1.xaos.ninja:4433',//;turn:turn2.xaos.ninja:4433',
  TURN_SECRET: 'c1e3705c2'
}

const urls = config.TURN_URLS
const secret = config.TURN_SECRET

function randomHexString(size) {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(size / 2, function(err, res) {
      if (err) return reject(err)
      resolve(res.toString('hex'))
    })
  })
}
async function genTurnAuth() {
    const expire = (Date.now() / 1000 + 1 * 60 * 60) | 0 // 1 hour
    const username = await randomHexString(10)
    const rusername = expire + ':' + username
    const password = crypto
    .createHmac('sha1', secret)
    .update(rusername)
    .digest('base64')
  /// TODO: select nearest servers by geoip
  console.dir({
    urls,
    username: rusername,
    credential: password
  })
}

genTurnAuth()
