var assert = require('assert');
var Queue = require('../lib/queue');
var SqlStore = require('../lib/stores/sql');

describe('SqlStore Usage', function() {
  it('sql store should queue length', function (done) {
    var s = new SqlStore();
    var q = new Queue(function (n, cb) {
      if (n === 1) {
        assert.equal(q.length, 0);
      }
      cb();
      done();
    }, { store: s, autoResume: false })
    q.push(1);
  });
});
