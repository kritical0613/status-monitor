(function () {
  'use strict';

  const path = require('path');
  const os = require('os');
  const onHeaders = require('on-headers');
  const pidusage = require('pidusage');

  const defaultConfig = {
    socketPort: 41338,
    path: '/status',
    spans: [{
      interval: 1,
      retention: 60
    }]
  };

  Array.prototype.last = function() {
    return this[this.length - 1];
  };

  const gatherOsMetrics = (io, span) => {
    const defaultResponse = {
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
      count: 0,
      mean: 0,
      timestamp: Date.now()
    };

    pidusage.stat(process.pid, (err, stat) => {

      // Convert from B to MB
      stat.memory = stat.memory / 1024 / 1024;
      stat.load = os.loadavg();
      stat.timestamp = Date.now();

      span.os.push(stat);
      if (!span.responses[0] || span.responses.last().timestamp + (span.interval * 1000) < Date.now()) span.responses.push(defaultResponse);

      if (span.os.length >= span.retention) span.os.shift();
      if (span.responses[0] && span.responses.length > span.retention) span.responses.shift();

      sendMetrics(io, span);
    });
  };

  const sendMetrics = (io, span) => {
    io.emit('stats', {
      os: span.os,
      responses: span.responses,
    });
  };

  const middlewareWrapper = (config) => {
    if (config === null || config === {} || config === undefined) {
      config = defaultConfig;
    }

    if (config.path === undefined || !config instanceof String) {
      config.path = defaultConfig.path;
    }

    if (config.socketPort === undefined || !config instanceof Number) {
      config.socketPort = defaultConfig.socketPort;
    }

    if (config.spans === undefined || !config instanceof Array) {
      config.spans = defaultConfig.span;
    }

    const io = require('socket.io')(config.socketPort);

    io.on('connection', (socket) => {
      console.log('User connected! ' + socket);
    });

    config.spans.forEach((span) => {
      span.os = [];
      span.responses = [];
      setInterval(() => gatherOsMetrics(io, span), span.interval * 1000);
    });

    return (req, res, next) => {
      const startTime = process.hrtime();
      if (req.path === config.path) {
        res.sendFile(path.join(__dirname + '/index.html'));
      } else {
        onHeaders(res, () => {
          const diff = process.hrtime(startTime);
          const responseTime = diff[0] * 1e3 + diff[1] * 1e-6;
          const category = Math.floor(res.statusCode / 100);

          config.spans.forEach((span) => {
            const last = span.responses[span.responses.length - 1];
            if (last !== undefined &&
              span.responses.last().timestamp / 1000 + span.interval > Date.now() / 1000) {
              span.responses.last()[category]++;
              span.responses.last().mean = responseTime;
              span.responses.last().count++;
            } else {
              span.responses.push({
                '2': category === 2 ? 1 : 0,
                '3': category === 3 ? 1 : 0,
                '4': category === 4 ? 1 : 0,
                '5': category === 5 ? 1 : 0,
                count: 1,
                mean: responseTime,
                timestamp: Date.now()
              });
            }
          });
        });

        next();
      }
    };
  };

  module.exports = middlewareWrapper;

}());