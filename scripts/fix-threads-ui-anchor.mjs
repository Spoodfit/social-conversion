import fs from 'node:fs';

const path = 'src/LiveAppV3.tsx';
let source = fs.readFileSync(path, 'utf8');

const generated = `            <button type="button" className="sc20-linkedin-provider" disabled={!linkedinReady} onClick={() => onConnectLinkedIn()}>
              <PlatformMark platform="linkedin" size={19} />
              <span><strong>LinkedIn</strong><small>{linkedinReady ? providerHint('linkedin', 'Ajouter un profil LinkedIn') : 'Configuration LinkedIn requise'}</small></span>
              {linkedinReady ? <ChevronRight size={17} /> : <span className="sc10-wait">À configurer</span>}
            </button>`;

const stable = `<button className="sc20-linkedin-provider" disabled={!linkedinReady} onClick={() => onConnectLinkedIn()}><PlatformMark platform="linkedin" size={19} /><span><strong>LinkedIn</strong><small>{linkedinReady ? 'Connecter votre profil personnel' : 'Configuration LinkedIn requise'}</small></span>{linkedinReady ? <ChevronRight size={17} /> : <span className="sc10-wait">À configurer</span>}</button>`;

if (source.includes(generated)) {
  source = source.replace(generated, `            ${stable}`);
} else if (!source.includes(stable)) {
  throw new Error('Threads UI anchor fix failed: generated LinkedIn provider button not found.');
}

fs.writeFileSync(path, source);
console.log('Threads account-panel insertion anchor normalized.');
