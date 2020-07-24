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
const NAMESPACE = 'public_ocfl';

var argv = require('yargs')
  .usage('Usage: $0 [options]')
  .describe('r', 'OCFL repo')
  .alias('r', 'repo')
  .string('r')
  .describe('n', 'Identifier namespace')
  .alias('n', 'namespace')
  .string('n')
  .default('n', NAMESPACE)
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

  const errors = {};

  for( let record of records ) {
  	logger.debug(record['path']);
		const inv = await record['ocflObject'].getInventory();
		const vhead = inv.head;
  	try {
  		logger.debug(`Loading ${record['path']} / ${record['metadata']}`)
  		const crate = new ROCrate(record['jsonld']);
  		crate.index();
  		var oid = crate.getNamedIdentifier(argv.namespace);
  		if( !oid ) {
  			logger.warn(`${record['path']}/${record['metadata']} couldn't find identifier in ${argv.namespace}`);
  			oid = record['path'];
  		}
  		logger.debug(`[${oid}] Checking files from ro-crate`);
  		const graph = crate.getGraph();
  		for( let item of graph ) {
  			if( item['@type'] === 'File' ) {
  				const file = item['@id'];
  				try { 
  					const fpath = await record['ocflObject'].getFilePath(file);
  					logger.debug(`[${oid}] ${file} found OK: ${fpath}`);
  				} catch(e) {
 						logger.error(`[${oid}] file missing from ${vhead}: ${file}`);
 						const occurs = await searchEarlier(record['ocflObject'], file);
 						if( Object.keys(occurs).length > 0 ) {
 							logger.info(`[${oid}] found this filename in versions: ${Object.keys(occurs)}`);
 						} else {
 							logger.info(`[${oid}] can't find filename in any version`);
 						}
  				}
  			}
  		}
  	} catch (e) {
  		logger.error(`Error reading ro-crate at ${record['path']}: ${e}`);
  	}
  }

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
    var metadata_file = null;
    for (let hash of Object.keys(headState)) {
      for( let cfile of catalogs ) {
        if (headState[hash].includes(cfile)) {
          const jsonfile = path.join(object.path, inv.manifest[hash][0]);
          metadata_file = cfile;
          json = await fs.readJson(jsonfile);
          break;
        }
      } 
    }
    if( json ) {
      records.push({
      	metadata: metadata_file,
        path: path.relative(repoPath, object.path),
        jsonld: json,
        ocflObject: object
      });
      logger.debug(`Loaded ocfl object ${object.path}`);
    } else {
      logger.error(`Couldn't find ${catalogFilename} in ${object.path}`);
    }
  }
  return records;
}


// Look up a file in any version of the inventory - called when we can't
// find a file in the head

async function searchEarlier(ocflObject, file) {
	const inv = await ocflObject.getInventory();
	const occurs = {};
	for( let v in inv.versions ) {
		for( let h in inv.versions[v].state ) {
			if( inv.versions[v].state[h].includes(file) ) {
				const fpath = inv.manifest[h][0];
				occurs[v] = fpath;
			}
		}
	}
	return occurs;
}
