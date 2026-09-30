import {useEffect, useState} from 'react';
import {db} from '../firebaseConfig';
import {collection, labelFirestoreTarget, documentId, limit, onSnapshot, orderBy, query, startAfter} from '../../performance/firestore';
import {subscribeFoePagingControl} from '../../data/configRepository';
import {FOE_PAGE_SIZE, pageFoes, reconcileFoeRows} from './foePage';

export default function useFoePage() {
  const [mode, setMode] = useState(null);
  const [anchors, setAnchors] = useState([null]);
  const [state, setState] = useState({rows: [], hasNext: false, cursor: null, loading: true, error: ''});
  const anchor = anchors.at(-1);
  useEffect(() => subscribeFoePagingControl({next: control => {
    const next = control?.version === 1 && control.mode === 'paged' ? 'paged' : 'legacy';
    setMode(previous => {
      if (previous !== next) setAnchors([null]);
      return next;
    });
  }, error: () => setState(previous => ({...previous, loading: false, error: 'Impossibile verificare la modalità della libreria.'}))}), []);

  useEffect(() => {
    if (!mode) return undefined;
    let active = true;
    setState(previous => ({...previous, loading: true, error: ''}));
    const source = collection(db, 'foes');
    const target = mode === 'paged' ? query(source,
      orderBy('task13OrderSeconds', 'desc'), orderBy(documentId(), 'asc'),
      ...(anchor ? [startAfter(anchor.seconds, anchor.id)] : []), limit(FOE_PAGE_SIZE + 1)) : source;
    const stop = onSnapshot(labelFirestoreTarget(target, mode === 'paged'
      ? 'foes.library.subscribe.v2' : 'foes.library-compatibility.subscribe.v1'), snapshot => {
      if (!active) return;
      const rows = snapshot.docs.map(item => ({...item.data(), id: item.id}));
      const visible = mode === 'paged' ? rows.slice(0, FOE_PAGE_SIZE) : pageFoes(rows, anchor).rows;
      const last = visible.at(-1);
      const page = mode === 'paged' ? {
        rows: visible, hasNext: rows.length > FOE_PAGE_SIZE,
        cursor: last ? {seconds: last.task13OrderSeconds, id: last.id} : null,
      } : pageFoes(rows, anchor);
      setState(previous => ({...page, rows: reconcileFoeRows(previous.rows, page.rows), loading: false, error: ''}));
    }, () => {
      if (active) setState(previous => ({...previous, loading: false, error: 'Impossibile caricare i foes. Ricarica la pagina e riprova.'}));
    });
    return () => {active = false; stop();};
  }, [mode, anchor]);
  return {...state, mode, page: anchors.length,
    next: () => {if (!state.loading && state.hasNext && state.cursor) setAnchors(value => [...value, state.cursor]);},
    previous: () => setAnchors(value => value.length > 1 ? value.slice(0, -1) : value),
    first: () => setAnchors([null]),
  };
}
