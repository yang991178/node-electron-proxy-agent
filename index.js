
/**
 * Module exports.
 */

module.exports = exports = ElectronProxyAgent;
/**
 * Module dependencies.
 */

var net = require('net');
var tls = require('tls');
var parse = require('url').parse;
var format = require('url').format;
var extend = require('extend');
var Agent = require('agent-base');
var HttpProxyAgent = require('http-proxy-agent');
var HttpsProxyAgent = require('https-proxy-agent');
var SocksProxyAgent = require('socks-proxy-agent');
var inherits = require('util').inherits;
var debug = require('debug')('electron-proxy-agent');

/**
 * The `ElectronProxyAgent` class.
 *
 * session : {
 *   resolveProxy(url, callback)
 * }
 *
 * See https://github.com/atom/electron/blob/master/docs/api/session.md#sesresolveproxyurl-callback
 *
 * @api public
 */

function ElectronProxyAgent(session) {
  if (!(this instanceof ElectronProxyAgent)) return new ElectronProxyAgent(session);

  if (!session || typeof(session.resolveProxy) !== 'function') {
    debug('no valid session found, trying to initialize ElectronProxyAgent with defaultSession');
    if (typeof(window) === 'undefined') {
      session = require('electron').session.defaultSession;
    } else {
      session = require('electron').remote.getCurrentWindow().webContents.session;
    }
  }

  Agent.call(this, connect);

  this.session = session;

  this.cache = this._resolver = null;

  this.agents = {}
}
inherits(ElectronProxyAgent, Agent);

/**
 * Called when the node-core HTTP client library is creating a new HTTP request.
 *
 * @api public
 */

function connect (req, opts, fn) {
  var url;
  var self = this;
  var secure = opts.protocol === "https:" || opts.protocol === "wss:";
  opts.secureEndpoint = opts.secureEndpoint || secure;
  opts.servername = opts.servername || opts.host;

  // calculate the `url` parameter
  var defaultPort = secure ? 443 : 80;
  var path = req.path;
  var firstQuestion = path.indexOf('?');
  var search;
  if (-1 != firstQuestion) {
    search = path.substring(firstQuestion);
    path = path.substring(0, firstQuestion);
  }
  url = format(extend({}, opts, {
    protocol: secure ? 'https:' : 'http:',
    pathname: path,
    search: search,

    // need to use `hostname` instead of `host` otherwise `port` is ignored
    hostname: opts.host,
    host: null,

    // set `port` to null when it is the protocol default port (80 / 443)
    port: defaultPort == opts.port ? null : opts.port
  }));

  debug('url: %o', url);
  var handled = false;
  var promise = self.session.resolveProxy(url, onproxy);
  if(promise && promise.then) {
    promise.then(onproxy);
  }

  // `resolveProxy()` callback function
  function onproxy (proxy) {
    if(handled) return;
    handled = true

    // default to "DIRECT" if a falsey value was returned (or nothing)
    if (!proxy) proxy = 'DIRECT';

    var proxies = String(proxy).trim().split(/\s*;\s*/g).filter(Boolean);

    // XXX: right now, only the first proxy specified will be used
    var first = proxies[0];
    debug('using proxy: %o', first);

    var agent;
    var parts = first.split(/\s+/);
    var type = parts[0];

    if ('DIRECT' == type) {
      // direct connection to the destination endpoint
      var socket;
      if (secure) {
        socket = tls.connect(opts);
      } else {
        socket = net.connect(opts);
      }
      return fn(null, socket);
    }
    if (self.agents[first]) {
      agent = self.agents[first];
    }
    else if ('SOCKS' == type || 'SOCKS5' == type) {
      // use a SOCKS proxy
      agent = new SocksProxyAgent('socks://' + parts[1]);
    } else if ('SOCKS4' == type) {
      agent = new SocksProxyAgent('socks4a://' + parts[1]);
    } else if ('PROXY' == type || 'HTTPS' == type || 'HTTP' == type) {
      // use an HTTP or HTTPS proxy
      // http://dev.chromium.org/developers/design-documents/secure-web-proxy
      var proxyURL = ('HTTPS' === type ? 'https' : 'http') + '://' + parts[1];
      var proxy = parse(proxyURL);
      if (secure) {
        agent = new HttpsProxyAgent(proxy);
      } else {
        agent = new HttpProxyAgent(proxy);
      }
    } else {
      throw new Error('Unknown proxy type: ' + type);
    }
    if (agent) {
      self.agents[first] = agent
      agent.callback(req, opts, fn);
    }
  }
}
