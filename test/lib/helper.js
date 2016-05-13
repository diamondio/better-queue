var async = require('async');
var mockery = require('mockery');
mockery.enable({ warnOnReplace: false, warnOnUnregistered: false });
mockery.registerMock('./PostgresAdapter', require('../fixtures/PostgresAdapter'));
mockery.registerMock('./SqliteAdapter', require('../fixtures/SqliteAdapter'));

exports.destroyQueues = function (done) {
  async.each([this.q, this.q1, this.q2], function (q, qCB) {
    if (!q) return qCB();
    setImmediate(function () {
      q.destroy(qCB);
    });
  }, function (err) {
    if (err) console.error(err);
    done();
  });
};
