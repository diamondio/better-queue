var assert = require('assert');
var Queue = require('../lib/queue');
var MemoryStore = require('../lib/stores/memory');

describe('Complex Queue', function() {

  it('should run in batch mode', function (done) {
    var q = new Queue({
      batchSize: 3,
      process: function (batch, cb) {
        assert.equal(Object.keys(batch).length, 3);
        var total = 0;
        Object.keys(batch).forEach(function (taskId) {
          total += batch[taskId];
        })
        cb(null, total);
      },
    })
    q.push(1, function (err, total) {
      assert.equal(total, 6);
    })
    q.push(2, function (err, total) {
      assert.equal(total, 6);
    })
    q.push(3, function (err, total) {
      assert.equal(total, 6);
      done();
    })
  })

  it('should store properly', function (done) {
    var s = new MemoryStore();
    var q1 = new Queue(function (n, cb) {
      cb(null, n+1);
    }, { store: s })
    q1.pause();
    q1.push(1);
    q1.push(2);
    q1.push(3);
    var q2 = new Queue(function (n, cb) {
      cb();
      if (n === 3) {
        done();
      }
    }, { store: s });
  })

  it('should retry', function (done) {
    var tries = 0;
    var q = new Queue(function (n, cb) {
      tries++;
      if (tries === 3) {
        cb();
        done();
      } else {
        cb('fail');
      }
    }, { maxRetries: 3 });
    q.push(1);
  })

  it('should fail retry', function (done) {
    var tries = 0;
    var q = new Queue(function (n, cb) {
      tries++;
      if (tries === 3) {
        cb();
      } else {
        cb('fail');
      }
    }, { maxRetries: 2 })
    q.on('task_failed', function () {
      done();
    });
    q.push(1);
  })

  it('should process delay', function () {
  })

  it('should max timeout', function () {
  })

  it('should merge tasks', function () {
  })
  
  it('should cancel if running', function () {
  })
  
  // TODO: Test stores
  // TODO: Test auto-resume

})
