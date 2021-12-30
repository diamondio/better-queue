var fs             = require('fs-extra');
var { v4: uuidv4 } = require('uuid');
var SqliteAdapter  = require('../../lib/stores/SqliteAdapter');

function MockSqliteAdapter(opts) {
  opts.verbose = false;
  opts.path = opts.path || uuidv4() + '.sqlite';
  SqliteAdapter.call(this, opts);
}

MockSqliteAdapter.prototype = Object.create(SqliteAdapter.prototype);

MockSqliteAdapter.prototype.close = function (cb) {
  var after = function () {
    SqliteAdapter.prototype.close.call(this, cb)
  }
  if (this.path === ':memory:') return after();
  fs.unlink(this.path, function (err) {
    after();
  });
}

module.exports = MockSqliteAdapter;
