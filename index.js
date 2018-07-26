const bq = require('./');
let cond = false;
const q = new bq((data, cb) => {
  console.log(data);
  cb();
}, {
  batchDelay: 500,
  maxRetries: 12,
  retryDelay: 5000,
  precondition: (cb) => {
    console.log('check precond');
    cb(null, cond);
  },
  preconditionRetryTimeout: 1000,
});

q.push(1);
q.push(2);
q.push(3);

setTimeout(() => (cond = true), 5000);
