/** Stream large JSON/binary values instead of raising the Server circuit message limit. */
export const maximumBytes = 64 * 1024 * 1024;
export function jsonText(value) { return JSON.stringify(value === undefined ? null : value); }
export function stream(value, format = 'json', limit = maximumBytes) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('The transfer limit must be a positive safe integer.');
  const blob = format === 'json' ? new Blob([jsonText(value)], { type: 'application/json' })
    : format === 'json-text' ? new Blob([value], { type: 'application/json' })
    : value instanceof Blob ? value : new Blob([value instanceof ArrayBuffer ? value :
        ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : Uint8Array.from(value)]);
  if (blob.size > limit) throw new RangeError(`Transfer exceeds the ${limit} byte limit.`);
  return DotNet.createJSStreamReference(blob);
}
export async function deliver(receiver, text) {
  if (text.length < 4096) return receiver.invokeMethodAsync('Dispatch', JSON.parse(text));
  const reference = stream(text, 'json-text');
  try { return await receiver.invokeMethodAsync('DispatchStream', reference); }
  catch (error) { DotNet.disposeJSObjectReference(reference); throw error; }
}
