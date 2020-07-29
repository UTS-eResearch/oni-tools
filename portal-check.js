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
const hasha = require('hasha');
const uuid = require('uuid');
const OCFLRepository = require('ocfl').Repository;
const winston = require('winston');
const cliProgress = require('cli-progress');

const DIGEST_ALGORITHM = 'sha512';

const CATALOGS = [ 'ro-crate-metadata.json', 'ro-crate-metadata.jsonld' ];
const NAMESPACE = 'public_ocfl';
const DOWNLOADS = './downloads';

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
  .alias('o', 'oni')
  .string('o')
  .default('v', false)
  .alias('v', 'verbose')
  .describe('v', 'verbose logging')
  .boolean('v')
  .default('f', false)
  .alias('f', 'fixity')
  .describe('f', 'Fixity check')
  .boolean('f')
  .default('d', '')
  .alias('d', 'download')
  .describe('d', 'Regexp filter for file download')
  .string('d')
  .help('h')
  .alias('h', 'help')
  .argv;


// TODO: log file


const consoleLog = new winston.transports.Console({
  level: argv.verbose ? 'debug' : 'info'
});

const logger = winston.createLogger({
  format: winston.format.simple(),
  transports: [ consoleLog ]
});


main(argv);

async function main (argv) {
  const oni = argv.oni;
	const records = await loadFromOcfl(argv.repo, CATALOGS);

  logger.info(`Got ${records.length} ocfl objects`);

  const errors = {};

  for( let record of records ) {
  	logger.debug(record['path']);
		const inv = await record['ocflObject'].getInventory();
    const vhead = inv.head;
    const manifest = inv.manifest;
  	try {
  		logger.debug(`Loading ${record['path']} / ${record['metadata']}`)
  		crate = new ROCrate(record['jsonld']);
  		crate.index();
    } catch (e) {
      logger.error(`Error reading ro-crate at ${record['path']}: ${e}`);
    }
    if( crate ) {
      const oid = crate.getNamedIdentifier(argv.namespace);
      if( !oid ) {
        logger.warn(`${record['path']}/${record['metadata']} couldn't find identifier in ${argv.namespace}`);
      }
  		logger.debug(`[${oid}] Checking files from ro-crate`);
  		const graph = crate.getGraph();
  		for( let item of graph ) {
  			if( item['@type'] === 'File' ) {
  				const file = item['@id'];
 					const fpath = await resolveOcfl(record['ocflObject'], file);
          if( fpath ) {
  					logger.debug(`[${oid}] ${file} found in ocfl repo OK: ${fpath}`);
  				} else {
 						logger.error(`[${oid}] file missing from ${vhead}: ${file}`);
 						const occurs = await searchEarlier(record['ocflObject'], file);
 						if( Object.keys(occurs).length > 0 ) {
 							logger.info(`[${oid}] found this filename in versions: ${Object.keys(occurs)}`);
 						} else {
 							logger.info(`[${oid}] can't find filename in any version`);
 						}
  				}
          if( argv.oni && oid && fpath ) {
            if( !argv.download || fpath.match(RegExp(argv.download)) ) {
              const dlfile = await resolveOni(argv.oni, oid, file);
              if( dlfile ) {
                logger.debug(`[${oid}] ${file} fetched from oni portal ok`);
                if( argv.fixity ) {
                  if( await checkFixity(manifest, fpath, dlfile) ) {
                    logger.debug(`[${oid}] ${file} download fixity OK`);
                  } else {
                    logger.error(`[${oid}] ${file} download fixity error`);
                  }
                }
              } else {
                logger.error(`[${oid}] ${file} fetch from oni failed`);
              }
            }
          }
  			}
  		}
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

// tries to resolve a path in an ocflObject to its path on the
// filesystem, returns null if this fails

async function resolveOcfl(ocflObject, file) {
  try {
    const fpath = await ocflObject.getFilePath(file);
    return fpath;
  } catch(e) {
    logger.debug(`resolution error ${e}`);
    return null;
  }
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

// TODO - make a version of this which cancels the gets so that we don't
// have to download an entire repo to verify that the links work?


async function resolveOni(oniUrl, oid, file) {
  const dlfile = path.join(DOWNLOADS, uuid.v4());
  try {
    await downloadFromOni(oniUrl, oid, file, dlfile);
    return dlfile
  } catch(e) {
    logger.error(`Download ${file} to ${dlfile} failed: ${e}`);
    return false;
  }
}




async function downloadFromOni(oniUrl, oid, file, dlfile) {
  const url = oniUrl + oid + '/' + file;
  const writer = fs.createWriteStream(dlfile);
  logger.info(`Download ${url} => ${dlfile}`);
  const response = await axios.get(url, { responseType: 'stream'});
  const size = response.headers['content-length'];
  var progress = 0;
  const pb = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  pb.start(size, 0);

  response.data.on('data', chunk => {
    progress += chunk.length;
    pb.update(progress);
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      pb.stop();
      resolve();
    });
    writer.on('error', () => {
      pb.stop();
      reject()
    });
  });
}


async function checkFixity(manifest, fpath, dlfile) {
  for( let hash in manifest ) {
    const mpath = manifest[hash];
    if( mpath.includes(fpath) ) {
      const dhash = await hasha.fromFile(dlfile, { algorithm: DIGEST_ALGORITHM });
      if( dhash === hash ) {
        logger.debug(`Fixity check passed: ${dlfile} ${fpath} ${dhash}`);
        return true;
      }
      logger.error(`${fpath} hash mismatch: expected ${hash} got ${dhash}`);
      return false;
    }
  }
  logger.error(`Couldn't find ${fpath} in manifest`);
  return false;
}