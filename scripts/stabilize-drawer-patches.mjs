import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('sc8-publish-hero') && !source.includes('sc7-drawer-summary')) {
  source = source.replace('className="sc8-publish-hero"', 'className="sc8-publish-hero sc7-drawer-summary"');
  fs.writeFileSync(path, source);
  console.log('Planner drawer patch markers stabilized.');
} else {
  console.log('Planner drawer patch markers already stable.');
}
