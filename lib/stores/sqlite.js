var SqlStore = require('./SqlStore');

function SQLiteStore(opts) {
  opts = opts || {};
  opts.dialect = 'sqlite';
  opts.path = opts.path || ':memory:';
  SqlStore.call(this, opts);
}

SQLiteStore.prototype = Object.create(SqlStore.prototype);

module.exports = SQLiteStore;
