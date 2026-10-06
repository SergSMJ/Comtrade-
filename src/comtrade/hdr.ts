/**
 * Розбір HDR-файлу терміналів ABB 670 (XML DisturbanceRecording).
 * Значення використовуються лише як еталон для звірки обчислень програми.
 */
import type { ReferenceData } from '../model/record';

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]] = m[2];
  return out;
}

function tags(xml: string, name: string): Record<string, string>[] {
  const re = new RegExp('<' + name + '\\s[^>]*>', 'g');
  return (xml.match(re) ?? []).map(attrs);
}

export function parseAbbHdr(text: string): ReferenceData | undefined {
  if (!text.includes('<DisturbanceRecording')) return undefined;
  const gen: Record<string, string> = {};
  for (const g of tags(text, 'general')) gen[g.name] = g.value;
  const fl: Record<string, string> = {};
  for (const g of tags(text, 'faultlocation')) fl[g.name] = g.value;
  const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));
  return {
    device: [gen.IEDsourceType, gen.IEDmodVersionNo].filter(Boolean).join(' '),
    lineLength: num(gen.LineLength),
    faultDistance: fl.FaultLocCalculationStatus === '0' ? num(fl.FaultLocDistanceToFault) : undefined,
    // Кодування петлі ABB у HDR не задокументоване публічно; номер наводиться як є.
    faultLoop: fl.FaultLocFaultedLoop !== undefined ? `код ${fl.FaultLocFaultedLoop}` : undefined,
    channels: tags(text, 'analoguechannel').map((c) => ({
      name: c.channelid,
      preRms: num(c.pretrigrmsvalue),
      preAngle: num(c.pretrigangle),
      faultRms: num(c.faultrmsvalue),
      faultAngle: num(c.faultangle),
    })),
    events: tags(text, 'event').map((e) => ({ time: e.datetime, name: e.channelid, state: e.statuschange })),
  };
}
