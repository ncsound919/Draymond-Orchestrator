import { recoverBrainFile, listJournaledFiles, compactJournal } from '../src/lib/draymond/journal';

const [,, cmd, file] = process.argv;

switch (cmd) {
  case 'recover': {
    if (!file) { console.error('usage: brain:recover -- <file.json>'); process.exit(1); }
    const content = recoverBrainFile(file);
    if (content === null) { console.error(`no journal history for ${file}`); process.exit(1); }
    console.log(`recovered ${file} (${Buffer.byteLength(content)} bytes)`);
    break;
  }
  case 'status': {
    for (const row of listJournaledFiles()) {
      console.log(`${row.file}: ${row.events} events, last ${row.lastTs}`);
    }
    break;
  }
  case 'compact': {
    const res = compactJournal();
    console.log(`snapshotted ${res.snapshotted} files, truncated ${res.truncated} rows`);
    break;
  }
  default:
    console.error('usage: brain:journal <recover|status|compact> [-- file.json]');
    process.exit(1);
}
