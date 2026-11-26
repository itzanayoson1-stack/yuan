// Loads ../engine.js (the exact rules the game page uses) into an isolated vm context.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
const EXPORTS = [
  'HOOK', 'ERA', 'GOAL', 'GOODS', 'SHIPS', 'PORTS', 'AREAS', 'WX_FUEL', 'SAVE_VERSION', 'BASE_FUEL',
  'newGame', 'tick', 'addShip', 'genContract', 'routes', 'plan', 'jobNet', 'netWorth', 'myRank', 'rankList',
  'doRefuel', 'doLoad', 'doUnload', 'doSail', 'doFish', 'doLayup', 'doReactivate', 'doOrder', 'doBuyUsed', 'doSellShip',
  'T', 'load', 'freeCap', 'canCarry', 'fuelPrice', 'oilLevel', 'creditLine', 'shipValue', 'bookValue', 'newPrice', 'fullWage', 'wage', 'portFee',
  'portOpen', 'portArea', 'dateOf', 'isValidSave',
  'GRADES', 'CAPTAINS', 'KINDS', 'doRepair', 'doHire', 'doFire', 'doBid', 'doRoute', 'tenderOdds', 'tenderScore', 'tenderCapacity', 'newTender',
  'lotQ', 'lotPay', 'fits', 'yardAt', 'repairCost', 'repairDays', 'fleetCount', 'fleetLimit', 'capFee', 'capWage', 'dayStep', 'addTrust', 'checkGrade', 'nearestYard', 'CAPT_FX',
];

function loadEngine() {
  const ctx = vm.createContext({ console, Math, JSON, Date });
  vm.runInContext(ENGINE, ctx, { filename: 'engine.js' });
  const api = vm.runInContext(`({ ${EXPORTS.join(', ')} })`, ctx);
  const getS = vm.runInContext('(() => S)', ctx);
  const setS = vm.runInContext('(v => { S = v; })', ctx);
  Object.defineProperty(api, 'S', { get: getS, set: setS });
  return api;
}

module.exports = { loadEngine };
