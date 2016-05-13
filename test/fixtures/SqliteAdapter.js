var uuid          = require('node-uuid');
var SqliteAdapter = require('../../lib/stores/SqliteAdapter');

function MockSqliteAdapter(opts) {
  opts.verbose = false;
  opts.path = uuid.v4() + '.sqlite';
  SqliteAdapter.call(this, opts);
}

MockSqliteAdapter.prototype = Object.create(SqliteAdapter.prototype);

module.exports = MockSqliteAdapter;
