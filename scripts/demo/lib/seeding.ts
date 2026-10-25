import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '@squad/core/node';
import { seedDb, type SeedSummary } from './db';
import { checkNoLeak, checkPlantedSentinels } from './checks';
import { loadSeedPack, plantedSentinels, publicSeedView, type SeedPack } from './seedpack';

/** Load, validate and sentinel-check the pack. Throws a readable error on any problem. */
export function loadAndVerifyPack(dir?: string): SeedPack {
  const pack = loadSeedPack(dir);
  const leak = checkNoLeak('seed-public', publicSeedView(pack));
  if (leak.status === 'FAIL') throw new Error(`seed: ${leak.message}`);
  const planted = checkPlantedSentinels(plantedSentinels(pack));
  if (planted.status === 'FAIL') throw new Error(`seed: ${planted.message}`);
  return pack;
}

export function runSeed(file: string, dir?: string): { pack: SeedPack; summary: SeedSummary } {
  const pack = loadAndVerifyPack(dir);
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openDb(file);
  try {
    return { pack, summary: seedDb(db, pack) };
  } finally {
    db.close();
  }
}

export function printSeedSummary(file: string, pack: SeedPack, s: SeedSummary): void {
  const names = pack.students.students.map((x) => x.name).join(', ');
  console.log(`seeded ${file}`);
  console.log(
    `  squad ${pack.students.squadId} "${pack.course.groupName}" (${pack.students.chatId})`,
  );
  console.log(`  ${s.students} students: ${names}`);
  console.log(
    `  ${s.calendars} calendars, ${s.busyBlocks} busy blocks (private, titles never printed)`,
  );
  console.log(`  trip ${pack.lodging.trip.tripId}: ${s.lodgingOptions} lodging options`);
  console.log(`  course ${pack.course.courseId}: ${s.chapters} chapters, ${s.personas} personas`);
  console.log('  private fields written to demo_seed (agent_private); values not shown');
}
