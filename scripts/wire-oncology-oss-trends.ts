import { persistInsightReport } from '../src/lib/science/trendsFeed';

const report = {
  from_domain: 'oncology',
  to_domain: 'trends',
  translated_metrics: [
    { name: 'oss_bridge_wired', value: 25, unit: 'tools', confidence: 0.92, provenance: 'lib/oss-bridge.ts:37 wiredCount 25/35' },
    { name: 'oss_bridge_total', value: 35, unit: 'tools', confidence: 1.0, provenance: 'OssToolId union 41 ids, 35 registry rows' },
    { name: 'oss_wired_pct', value: 71.4, unit: '%', confidence: 0.92, provenance: '25/35' },
    { name: 'tcga_all_comers_deltaC', value: 0.0324, unit: 'ΔC', confidence: 0.99, provenance: 'h1c_tcga_replication.json 852 pts p=0.0006' },
    { name: 'gse20685_deltaC', value: 0.1445, unit: 'ΔC', confidence: 0.97, provenance: 'round100.json 327 pts' },
    { name: 'pooled_random_deltaC', value: 0.0321, unit: 'ΔC', confidence: 0.95, provenance: '5 studies random 0.0084-0.0558 I254%' },
    { name: 'batss_tri_seq_vs_conc', value: 18.2, unit: 'volume', confidence: 0.88, provenance: 'BATSS 200-sim Tri-seq 18.2 vs conc 42.1' },
    { name: 'oncoforesight_auc_remission', value: 0.851, unit: 'AUC', confidence: 0.90, provenance: 'OncoForesight backtest 126 pts' },
    { name: 'mrd_lead_days', value: 56, unit: 'days', confidence: 0.85, provenance: 'mrd.ts molecular recurrence → PD' },
  ],
  confidence: 0.91,
  evidence_tier: 'E3',
  summary: 'Oncology 6-base engine: 25/35 OSS wired (+13), real TCGA/METABRIC pooled ΔC 0.032 replicating, BATSS tri-seq superior, MRD kinetics continuous',
  generated_at: new Date().toISOString(),
};

const meta = {
  source: 'oncology',
  sessionId: `oss-bridge-${new Date().toISOString().slice(0,10)}`,
  domain: 'oncology',
  evidenceTier: 'E3' as const,
};

persistInsightReport(report as any, meta).then(r=>{
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok?0:1);
}).catch(e=>{ console.error(e); process.exit(1); });
