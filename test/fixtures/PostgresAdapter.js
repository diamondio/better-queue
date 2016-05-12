var PostgresAdapter = require('../../lib/stores/PostgresAdapter');
var g_client; // reuse the connection

function MockPostgresAdapter(opts) {
  PostgresAdapter.call(this, opts);
}

MockPostgresAdapter.prototype = Object.create(PostgresAdapter.prototype);
MockPostgresAdapter.prototype.connect = function (cb) {
  if (g_client) {
    this.adapter = g_client;
    return cb();
  }

  var self = this;
  PostgresAdapter.prototype.connect.call(self, function (err, client) {
    if (err) return cb(err);
    g_client = client;
    cb();
  });
};

module.exports = MockPostgresAdapter;
