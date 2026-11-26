// The list of the sample reports of the demo: samples/samples.ini (the list of the designers' welcome
// window), read without the engine (the page of the designer does not need it).

/** A sample of samples.ini. */
export interface Sample {
  /** The file name without .rep. */
  name: string;
  title: string;
  description: string;
  thumbnail: string | null;
}

/** The samples in the order of samples.ini, with the texts of a language ('en', 'es'...). */
export async function loadSamples(base: string, language: string): Promise<Sample[]> {
  const r = await fetch(base + 'samples/samples.ini');
  if (!r.ok) throw new Error('samples/samples.ini: ' + String(r.status));
  const samples: Sample[] = [];
  let keys: Map<string, string> | null = null;
  let file = '';
  const flush = (): void => {
    if (keys === null || !file.toLowerCase().endsWith('.rep')) return;
    const text = (key: string): string => keys!.get(`${key}.${language}`.toLowerCase()) ?? keys!.get(key.toLowerCase()) ?? '';
    samples.push({
      name: file.slice(0, -4),
      title: text('Title') || file,
      description: text('Description'),
      thumbnail: keys.get('thumbnail') ?? null,
    });
  };
  for (const raw of (await r.text()).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith(';')) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section !== null) {
      flush();
      file = section[1]!;
      keys = new Map();
      continue;
    }
    const k = line.indexOf('=');
    if (k > 0 && keys !== null) keys.set(line.slice(0, k).trim().toLowerCase(), line.slice(k + 1).trim());
  }
  flush();
  return samples;
}
