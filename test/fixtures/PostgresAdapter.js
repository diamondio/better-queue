var PostgresAdapter = require('../../lib/stores/PostgresAdapter');

var g_client; // reuse the connection

function MockPostgresAdapter(opts) {
  opts.verbose = false;
  opts.username = 'diamond';
  opts.dbname = 'diamond';
  PostgresAdapter.call(this, opts);
}

MockPostgresAdapter.prototype = Object.create(PostgresAdapter.prototype);

MockPostgresAdapter.prototype.connect = function (cb) {
  if (g_client) {
    this.adapter = g_client;
    return cb();
  }

  PostgresAdapter.prototype.connect.call(this, function (err, client) {
    if (err) return cb(err);
    g_client = client;
    cb();
  });
};

module.exports = MockPostgresAdapter;
