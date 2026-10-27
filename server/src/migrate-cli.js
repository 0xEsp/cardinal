// Ensaya o aplica las migraciones sin arrancar el servidor.
//   node server/src/migrate-cli.js --dry-run   migra, verifica y revierte
//   node server/src/migrate-cli.js             aplica (con copia previa)
// El despliegue lo usa con --dry-run sobre una copia de data/ antes de cambiar
// de imagen: si falla, la versión anterior sigue funcionando.

process.env.CARDINAL_MIGRATE = 'skip';
const dryRun = process.argv.includes('--dry-run');

try {
  const { db } = await import('./db.js');
  const { runMigrations, LATEST_VERSION } = await import('./migrate.js');
  const report = runMigrations(db, { dryRun });
  if (report.from === LATEST_VERSION) {
    console.log(`La base ya está en v${LATEST_VERSION}: nada que migrar.`);
  } else {
    for (const step of report.steps) {
      console.log(`v${step.version} OK · importados ${step.imported} docs/reglas · filas: ${JSON.stringify(step.counts)}`);
    }
    for (const file of report.backups) console.log(`Copia previa: ${file}`);
    console.log(dryRun ? 'Ensayo correcto: no se ha modificado la base.' : `Base migrada a v${report.to}.`);
  }
  db.close();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
