
var Ticket = require('./ticket');

function Tickets() {
  this.tickets = [];
}

Tickets.prototype._apply = function (fn, args) {
  this.tickets.forEach(function (ticket) {
    ticket[fn].apply(ticket, args);
  })
}

Tickets.prototype.push = function (ticket) {
  this.tickets.push(ticket);
}

Object.keys(Ticket.prototype).forEach(function (method) {
  Tickets.prototype[method] = function () {
    this._apply(method, arguments);
  }
})

module.exports = Tickets;
