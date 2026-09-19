import { writeCircleReport } from "../src/lib/draymond/circle-report";

writeCircleReport()
  .then(({ report, jsonPath, mdPath }) => {
    const settled = (report.totals.settlementCents / 100).toFixed(2);
    const broken =
      report.brokenLinks.missionsWithoutEngine.length +
      report.brokenLinks.missionsWithoutLane.length +
      report.brokenLinks.opportunitiesWithoutEngine.length +
      report.brokenLinks.invoicesWithoutMappedService.length;
    console.log(
      `circle-report: ${report.totals.missions} missions, settled $${settled}, broken links ${broken}`,
    );
    console.log(`wrote ${jsonPath}`);
    console.log(`wrote ${mdPath}`);
  })
  .catch((err) => {
    console.error(`circle-report failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
