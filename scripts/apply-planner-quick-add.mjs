import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Planner quick-add patch failed: ${label} anchor not found.`);
  source = source.replace(before, after);
}

function addEditHint() {
  replaceOnce(
`                          onClick={(event) => { event.stopPropagation(); onEdit(publication); }}
                        >
                          {media?.mimeType.startsWith('image/') && <img src={media.previewUrl} alt="" />}`,
`                          onClick={(event) => { event.stopPropagation(); onEdit(publication); }}
                          title="Cliquer pour modifier cette publication"
                        >
                          <span className="sc5-edit-hint"><Pencil size={10} /> Modifier</span>
                          {media?.mimeType.startsWith('image/') && <img src={media.previewUrl} alt="" />}`,
    'publication edit hint',
  );
}

if (source.includes('sc5-edit-hint')) {
  console.log('Planner quick-add/edit hover already applied.');
  process.exit(0);
}

// Upgrade an already-patched local working tree safely.
if (source.includes('sc5-planner-quick-add')) {
  replaceOnce(
`                    onMouseMove={(event: MouseEvent<HTMLElement>) => {
                      if (draggedPublicationId) return;
                      const rect = event.currentTarget.getBoundingClientRect();`,
`                    onMouseMove={(event: MouseEvent<HTMLElement>) => {
                      if (draggedPublicationId) return;
                      const target = event.target as HTMLElement;
                      if (target.closest('.sc3-agenda-card')) {
                        setHoverSlot((current) => current?.dateKey === key ? undefined : current);
                        return;
                      }
                      const rect = event.currentTarget.getBoundingClientRect();`,
    'suppress quick add over publication',
  );
  addEditHint();
  fs.writeFileSync(path, source);
  console.log('Planner quick-add upgraded with distinct edit hover.');
  process.exit(0);
}

replaceOnce(
`  type DragEvent,\n  type FormEvent,\n} from 'react';`,
`  type DragEvent,\n  type FormEvent,\n  type MouseEvent,\n} from 'react';`,
  'mouse event import',
);

replaceOnce(
`  const end = addDays(weekStart, 6);\n  const scrollRef = useRef<HTMLDivElement>(null);`,
`  const end = addDays(weekStart, 6);\n  const scrollRef = useRef<HTMLDivElement>(null);\n  const [hoverSlot, setHoverSlot] = useState<{ dateKey: string; minutes: number; top: number }>();`,
  'hover slot state',
);

replaceOnce(
`                    onDragOver={(event) => event.preventDefault()}\n                    onDrop={(event: DragEvent<HTMLElement>) => {`,
`                    onMouseMove={(event: MouseEvent<HTMLElement>) => {\n                      if (draggedPublicationId) return;\n                      const target = event.target as HTMLElement;\n                      if (target.closest('.sc3-agenda-card')) {\n                        setHoverSlot((current) => current?.dateKey === key ? undefined : current);\n                        return;\n                      }\n                      const rect = event.currentTarget.getBoundingClientRect();\n                      const y = Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top));\n                      const rawMinutes = (y / rect.height) * 24 * 60;\n                      const minutes = Math.max(0, Math.min(23 * 60 + 45, Math.round(rawMinutes / 15) * 15));\n                      const top = Math.max(18, Math.min(DAY_HEIGHT - 18, (minutes / 60) * SLOT_HEIGHT));\n                      setHoverSlot({ dateKey: key, minutes, top });\n                    }}\n                    onMouseLeave={() => setHoverSlot((current) => current?.dateKey === key ? undefined : current)}\n                    onClick={(event: MouseEvent<HTMLElement>) => {\n                      if (draggedPublicationId) return;\n                      const target = event.target as HTMLElement;\n                      if (target.closest('.sc3-agenda-card')) return;\n                      const rect = event.currentTarget.getBoundingClientRect();\n                      const y = Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top));\n                      const rawMinutes = (y / rect.height) * 24 * 60;\n                      const minutes = Math.max(0, Math.min(23 * 60 + 45, Math.round(rawMinutes / 15) * 15));\n                      onCreate(key, minutes);\n                    }}\n                    onDragOver={(event) => event.preventDefault()}\n                    onDrop={(event: DragEvent<HTMLElement>) => {`,
  'single click and hover handlers',
);

replaceOnce(
`                    onDoubleClick={(event) => {\n                      const rect = event.currentTarget.getBoundingClientRect();\n                      const y = Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top));\n                      const rawMinutes = (y / rect.height) * 24 * 60;\n                      const minutes = Math.max(0, Math.min(23 * 60 + 45, Math.round(rawMinutes / 15) * 15));\n                      onCreate(key, minutes);\n                    }}\n                  >`,
`                  >`,
  'remove double click requirement',
);

replaceOnce(
`                    {isToday && (() => {\n                      const now = new Date();\n                      const top = ((now.getHours() * 60 + now.getMinutes()) / 60) * SLOT_HEIGHT;\n                      return <div className="sc3-now-line" style={{ top }}><span /></div>;\n                    })()}\n                    {items.map((publication, index) => {`,
`                    {isToday && (() => {\n                      const now = new Date();\n                      const top = ((now.getHours() * 60 + now.getMinutes()) / 60) * SLOT_HEIGHT;\n                      return <div className="sc3-now-line" style={{ top }}><span /></div>;\n                    })()}\n                    {hoverSlot?.dateKey === key && !draggedPublicationId && (\n                      <button\n                        type="button"\n                        className="sc5-planner-quick-add"\n                        style={{ top: hoverSlot.top }}\n                        onClick={(event) => { event.stopPropagation(); onCreate(key, hoverSlot.minutes); }}\n                      >\n                        <Plus size={11} />\n                        <span>{String(Math.floor(hoverSlot.minutes / 60)).padStart(2, '0')}:{String(hoverSlot.minutes % 60).padStart(2, '0')}</span>\n                      </button>\n                    )}\n                    {items.map((publication, index) => {`,
  'quick add affordance',
);

addEditHint();

fs.writeFileSync(path, source);
console.log('Planner light quick-add and publication edit hover applied.');
