// Test fixture: stands in for ACE/gate.py so the governance bridge can be
// exercised without a Python runtime. Reads a ProposedAction on stdin and
// emits whatever STUB_GATE_OUTPUT says, or fails per STUB_GATE_MODE.
let _raw = '';
process.stdin.on('data', (d) => { _raw += d; });
process.stdin.on('end', () => {
  const mode = process.env.STUB_GATE_MODE;
  if (mode === 'exit') process.exit(3);
  if (mode === 'garbage') { process.stdout.write('not json'); return; }
  process.stdout.write(
    process.env.STUB_GATE_OUTPUT || JSON.stringify({ verdict: 'allow', reason: 'stub' })
  );
});
