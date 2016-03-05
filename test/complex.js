var assert = require('assert');
var Queue = require('../lib/queue');

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

  it('should retry', function () {
  })

  it('should process delay', function () {
  })

  it('should max timeout', function () {
  })

  it('should merge tasks', function () {
  })
  
  it('should cancel if running', function () {
  })
  
})
