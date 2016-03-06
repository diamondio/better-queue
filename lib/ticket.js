
var util = require('util');
var EE   = require('events').EventEmitter;
var ETA  = require('node-eta');

function Ticket(opts) {
  this.isAccepted = false;
  this.isQueued = false;
  this.isStarted = false;
  this.isFailed = false;
  this.isFinished = false;
  this.result = null;
  this.status = 'created';
  this.eta = new ETA();
}

util.inherits(Ticket, EE);

Ticket.prototype.accept = function () {
  this.status = 'accepted';
  this.isAccepted = true;
}

Ticket.prototype.queued = function () {
  this.status = 'queued';
  this.isQueued = true;
}

Ticket.prototype.unqueued = function () {
  this.status = 'accepted';
  this.isQueued = false;
}

Ticket.prototype.started = function () {
  this.eta.count = 1;
  this.eta.start();
  this.isStarted = true;
  this.status = 'in-progress';
}

Ticket.prototype.failed = function (msg) {
  this.isFailed = true;
  this.isFinished = true;
  this.status = 'failed';
  this.emit('failed', msg);
}

Ticket.prototype.finish = function (result) {
  this.eta.done = this.eta.count;
  this.isFinished = true;
  this.status = 'finished';
  this.result = result;
  this.emit('finish', this.result);
}

Ticket.prototype.stopped = function () {
  this.eta = new ETA();
  this.isFinished = false;
  this.isStarted = false;
  this.status = 'queued';
  this.result = null;
}

Ticket.prototype.progress = function (current, total) {
  this.eta.done = current;
  this.eta.count = total;
  this.emit('progress', {
    current: this.eta.done,
    total: this.eta.count,
    pct: (this.eta.done/this.eta.count)*100,
    eta: this.eta.format('{{etah}}')
  });
}

module.exports = Ticket;
