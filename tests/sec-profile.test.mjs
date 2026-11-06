/**
 * Snake Eye — security kind and industry from SEC submissions.
 *
 * The fixtures copy the fields that matter from real EDGAR payloads (November
 * 2026): GRX, NIO, SHOP, ARCC, PLUG.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProfile, titleCase } from '../scripts/lib/sec-profile.mjs';

const filer = ({ forms, sic = '', sicDescription = '', foreign = null }) => ({
  sic,
  sicDescription,
  addresses: { business: foreign ? { isForeignLocation: 1, country: foreign } : { isForeignLocation: null, country: null } },
  filings: { recent: { form: forms } },
});

test('a closed-end fund is a fund, with an industry even though SEC gives none', () => {
  const grx = buildProfile(filer({ forms: ['4', 'NPORT-P', 'N-CSRS', 'N-CEN', 'N-2', 'N-CSR'] }));
  assert.equal(grx.kind, 'fund');
  assert.equal(grx.industry, 'Closed-end fund');
  assert.equal(grx.country, null);
});

test('a 20-F filer reads as an ADR and keeps its country', () => {
  const nio = buildProfile(filer({
    forms: ['6-K', '6-K', '20-F', '6-K'],
    sic: '3711',
    sicDescription: 'Motor Vehicles & Passenger Car Bodies',
    foreign: 'China',
  }));
  assert.equal(nio.kind, 'adr');
  assert.equal(nio.industry, 'Motor Vehicles & Passenger Car Bodies');
  assert.equal(nio.country, 'China');
});

test('the newest annual form decides: a former 40-F filer now on 10-K is domestic', () => {
  const shop = buildProfile(filer({
    forms: ['8-K', '10-Q', '10-K', '6-K', '40-F'],
    sicDescription: 'SERVICES-PREPACKAGED SOFTWARE',
    foreign: 'Ontario, Canada',
  }));
  assert.equal(shop.kind, 'stock');
  assert.equal(shop.industry, 'Services-Prepackaged Software');
  assert.equal(shop.country, 'Ontario, Canada');
});

test('a BDC registers like a fund but reports like a company', () => {
  assert.equal(buildProfile(filer({ forms: ['8-K', 'N-2', '10-Q', '10-K', 'NPORT-P'] })).kind, 'stock');
});

test('a plain domestic filer', () => {
  const plug = buildProfile(filer({ forms: ['4', '8-K', '10-Q', '10-K'], sic: '3620', sicDescription: 'ELECTRICAL INDUSTRIAL APPARATUS' }));
  assert.deepEqual(plug, {
    kind: 'stock', industry: 'Electrical Industrial Apparatus', sic: '3620', country: null, source: 'SEC EDGAR',
  });
});

test('titleCase keeps short joining words lower case', () => {
  assert.equal(titleCase('REAL ESTATE INVESTMENT TRUSTS'), 'Real Estate Investment Trusts');
  assert.equal(titleCase('SERVICES-COMPUTER PROGRAMMING, DATA PROCESSING, ETC.'), 'Services-Computer Programming, Data Processing, Etc.');
  assert.equal(titleCase('MOTOR VEHICLE PARTS & ACCESSORIES'), 'Motor Vehicle Parts & Accessories');
  assert.equal(titleCase('BLANK CHECKS'), 'Blank Checks');
  assert.equal(titleCase('SAVINGS INSTITUTION, FEDERALLY CHARTERED'), 'Savings Institution, Federally Chartered');
  assert.equal(titleCase('WHOLESALE-DRUGS PROPRIETARIES & DRUGGISTS\' SUNDRIES'), 'Wholesale-Drugs Proprietaries & Druggists\' Sundries');
  assert.equal(titleCase('  '), null);
});
