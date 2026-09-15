import fs from 'node:fs';

const appPath = 'src/LiveAppV3.tsx';
let app = fs.readFileSync(appPath, 'utf8');

if (app.includes('SC_PLANNER_MONTH_VIEW_V1')) {
  console.log('Planner month view already applied.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  if (!app.includes(before)) throw new Error(`Planner month view patch failed: ${label} anchor not found.`);
  app = app.replace(before, after);
}

replaceOnce(
  `type PlannerView = 'week' | 'list';`,
  `type PlannerView = 'week' | 'month' | 'list';`,
  'planner view type',
);

replaceOnce(
`  const [expandedSlot, setExpandedSlot] = useState<string>();`,
`  const [expandedSlot, setExpandedSlot] = useState<string>();
  const [monthDate, setMonthDate] = useState(() => new Date());
  const monthGridStart = useMemo(
    () => mondayOf(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)),
    [monthDate],
  );
  const monthDays = useMemo(
    () => Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index)),
    [monthGridStart],
  );
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(monthDate),
    [monthDate],
  );`,
  'month state',
);

replaceOnce(
`      <div className="sc3-planner-toolbar">
        <div className="sc3-week-controls">
          <button onClick={() => onWeek(addDays(weekStart, -7))}><ChevronLeft size={17} /></button>
          <button className="sc3-today" onClick={() => onWeek(mondayOf(new Date()))}>Aujourd’hui</button>
          <button onClick={() => onWeek(addDays(weekStart, 7))}><ChevronRight size={17} /></button>
          <strong>{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(weekStart)} — {new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(end)}</strong>
        </div>
        <div className="sc3-view-switch">
          <button className={view === 'week' ? 'active' : ''} onClick={() => onView('week')}><LayoutGrid size={15} /> Semaine</button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => onView('list')}><List size={15} /> Liste</button>
        </div>
      </div>`,
`      <div className="sc3-planner-toolbar">
        <div className="sc3-week-controls">
          <button
            aria-label={view === 'month' ? 'Mois précédent' : 'Semaine précédente'}
            onClick={() => view === 'month'
              ? setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))
              : onWeek(addDays(weekStart, -7))}
          ><ChevronLeft size={17} /></button>
          <button
            className="sc3-today"
            onClick={() => view === 'month' ? setMonthDate(new Date()) : onWeek(mondayOf(new Date()))}
          >Aujourd’hui</button>
          <button
            aria-label={view === 'month' ? 'Mois suivant' : 'Semaine suivante'}
            onClick={() => view === 'month'
              ? setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))
              : onWeek(addDays(weekStart, 7))}
          ><ChevronRight size={17} /></button>
          <strong className={view === 'month' ? 'sc15-month-title' : undefined}>
            {view === 'month'
              ? monthLabel
              : <>{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(weekStart)} — {new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(end)}</>}
          </strong>
        </div>
        <div className="sc3-view-switch">
          <button className={view === 'week' ? 'active' : ''} onClick={() => onView('week')}><LayoutGrid size={15} /> Semaine</button>
          <button className={view === 'month' ? 'active' : ''} onClick={() => { setMonthDate(weekStart); onView('month'); }}><CalendarDays size={15} /> Mois</button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => onView('list')}><List size={15} /> Liste</button>
        </div>
      </div>`,
  'planner toolbar',
);

replaceOnce(
`      {!loading && view === 'list' && (
        <div className="sc3-planner-list">`,
`      {!loading && view === 'month' && (
        <div className="sc15-month-shell">
          <div className="sc15-month-scroll">
            <div className="sc15-month-weekdays" aria-hidden="true">
              {['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'].map((label) => <span key={label}>{label}</span>)}
            </div>
            <div className="sc15-month-grid">
              {monthDays.map((day) => {
                const key = localDateKey(day);
                const dayItems = [...(byDay.get(key) ?? [])].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
                const inMonth = day.getMonth() === monthDate.getMonth() && day.getFullYear() === monthDate.getFullYear();
                const isToday = key === localDateKey(new Date());
                const visibleItems = dayItems.slice(0, 3);
                const hiddenCount = Math.max(0, dayItems.length - visibleItems.length);
                return (
                  <section key={key} className={\`sc15-month-day\${inMonth ? '' : ' outside'}\${isToday ? ' today' : ''}\`}>
                    <header>
                      <button
                        type="button"
                        className="sc15-day-number"
                        onClick={() => { onWeek(mondayOf(day)); onView('week'); }}
                        title="Voir cette semaine"
                      >
                        <span>{day.getDate()}</span>
                        {dayItems.length > 0 && <em>{dayItems.length}</em>}
                      </button>
                      <button
                        type="button"
                        className="sc15-day-add"
                        onClick={() => onCreate(key, 10 * 60)}
                        aria-label={\`Ajouter une publication le \${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(day)}\`}
                        title="Ajouter une publication"
                      ><Plus size={13} /></button>
                    </header>
                    <div className="sc15-month-items">
                      {visibleItems.map((publication) => {
                        const media = library.get(mediaIdFromReference(publication.mediaReference) ?? '');
                        return (
                          <button
                            type="button"
                            key={publication.id}
                            className={\`sc15-month-post\${publication.readOnly ? ' provider' : ''}\`}
                            onClick={() => onEdit(publication)}
                            title={publication.readOnly ? 'Ouvrir sur le réseau' : 'Modifier la publication'}
                          >
                            <span className="sc15-month-thumb">
                              {media?.mimeType.startsWith('image/')
                                ? <img src={media.previewUrl} alt="" />
                                : <span>{publication.targets.slice(0, 1).map((target) => <PlatformMark key={target.id} platform={target.platform} size={12} />)}</span>}
                            </span>
                            <span className="sc15-month-copy">
                              <span><time>{formatTime(publication.scheduledAt)}</time>{publication.readOnly && <em>{publication.providerStatus === 'scheduled' ? 'Programmé' : 'Publié'}</em>}</span>
                              <strong>{publication.body || 'Publication'}</strong>
                            </span>
                            <span className="sc15-month-platforms">{publication.targets.slice(0, 3).map((target) => <PlatformMark key={target.id} platform={target.platform} size={9} />)}</span>
                          </button>
                        );
                      })}
                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          className="sc15-month-more"
                          onClick={() => { onWeek(mondayOf(day)); onView('week'); }}
                        >+{hiddenCount} autre{hiddenCount > 1 ? 's' : ''}</button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {!loading && view === 'list' && (
        <div className="sc3-planner-list">`,
  'month grid',
);

app += '\n/* SC_PLANNER_MONTH_VIEW_V1 */\n';
fs.writeFileSync(appPath, app);

const mainPath = 'src/main.tsx';
let main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("./planner-month-view.css")) {
  main += "\nimport './planner-month-view.css';\n";
  fs.writeFileSync(mainPath, main);
}

console.log('Planner month overview applied.');
