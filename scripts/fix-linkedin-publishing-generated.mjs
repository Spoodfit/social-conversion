import fs from 'node:fs';

// Final generated-code stabilization. This runs after every older UI patch has finished,
// so LinkedIn and Facebook remain real Planner destinations without malformed ternaries.
const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');
app = app.replace(
  `const publishableKnown = known.filter((connection) => connection.platform !== 'facebook' && connection.platform !== 'linkedin');`,
  `const publishableKnown = known;`,
);
app = app.replace(
  `setSelectedConnectionIds(selected?.platform === 'facebook' || [id]);`,
  `setSelectedConnectionIds([id]);`,
);
app = app.replaceAll(
  `setSelectedConnectionIds(selected?.platform === 'linkedin' || [id]);`,
  `setSelectedConnectionIds([id]);`,
);
if (app.includes(`setSelectedConnectionIds(selected?.platform === 'facebook' || [id]);`)) {
  throw new Error('LinkedIn generated UI fix failed: malformed switch-account expression remains.');
}
if (!app.includes(`connection.platform === 'linkedin'`)) {
  throw new Error('LinkedIn generated UI fix failed: LinkedIn is missing from publishable connections.');
}
app += app.includes('SC_LINKEDIN_PUBLISHING_GENERATED_V1') ? '' : '\n/* SC_LINKEDIN_PUBLISHING_GENERATED_V1 */\n';
fs.writeFileSync(appPath, app);

// lucide-react in this project does not expose a Linkedin component. Keep the same small
// native glyph already used by Social Conversion's account switcher instead of adding a dependency.
const editorPath = 'src/PlatformDestinationEditor.tsx';
let editor = fs.readFileSync(editorPath, 'utf8');
editor = editor.replace('Camera, Check, Linkedin, MessageCircle', 'Camera, Check, MessageCircle');
editor = editor.replace(
  `<Linkedin size={15} />`,
  `<strong className="sc20-linkedin-glyph" aria-hidden="true">in</strong>`,
);
fs.writeFileSync(editorPath, editor);

const previewPath = 'src/PlannerComposerPreview.tsx';
let preview = fs.readFileSync(previewPath, 'utf8');
preview = preview.replace('Camera, Linkedin, MessageCircle', 'Camera, MessageCircle');
preview = preview.replaceAll(
  `<Linkedin size={14} />`,
  `<strong className="sc20-linkedin-glyph" aria-hidden="true">in</strong>`,
);
preview = preview.replaceAll(
  `<Linkedin size={13} />`,
  `<strong className="sc20-linkedin-glyph" aria-hidden="true">in</strong>`,
);
fs.writeFileSync(previewPath, preview);

console.log('Generated LinkedIn publishing UI stabilized.');
