#!/usr/bin/env node

// test script outline

// adapt indexing script

// iterate over the ocfl repository

// get the ro-crate for each dataset

// extract all of the file links from the ro-crate

// check whether they're in the ocfl head version
// (ie is the ocfl/ro-crate internally consistent)

// then try to fetch them from oni and see what happens


const axios = require('axios');
const _ = require('lodash');
const ROCrate = require('ro-crate').ROCrate;
const fs = require('fs-extra');
const path = require('path');
const OCFLRepository = require('ocfl').Repository;
const winston = require('winston');

const consoleLog = new winston.transports.Console();
const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [ consoleLog ]
});

const CATALOGS = [ 'ro-crate-metadata.json', 'ro-crate-metadata.jsonld' ];

var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .describe('r', 'OCFL repo')
  .alias('r', 'repo')
  .string('r')
  .describe('o', 'Oni URL')
  .alias('o', 'oni')
  .string('o')
  .help('h')
  .alias('h', 'help')
  .argv;



main(argv);

async function main (argv) {
	const records = await loadFromOcfl(argv.repo, CATALOGS);

  logger.info(`Got ${records.length} ocfl objects`);

}







async function loadFromOcfl(repoPath, catalogFilename) {
  const repo = new OCFLRepository();
  await repo.load(repoPath);

  const objects = await repo.objects();
  const records = [];
  const catalogs = Array.isArray(catalogFilename) ? catalogFilename : [ catalogFilename ];

  for ( let object of objects ) {
    const inv = await object.getInventory();
    const headState = inv.versions[inv.head].state;
    var json = null;
    for (let hash of Object.keys(headState)) {
      for( let cfile of catalogs ) {
        if (headState[hash].includes(cfile)) {
          const jsonfile = path.join(object.path, inv.manifest[hash][0]);
          json = await fs.readJson(jsonfile);
          break;
        }
      } 
    }
    if( json ) {
      records.push({
        path: path.relative(repoPath, object.path),
        jsonld: json,
        ocflObject: object
      });
      logger.info(`Loaded ocfl object ${object.path}`);
    } else {
      logger.error(`Couldn't find ${catalogFilename} in ${object.path}`);
    }
  }
  return records;
}


