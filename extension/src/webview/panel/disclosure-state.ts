export function syncDisclosureOpenState(
  currentOpen: boolean,
  previousDefaultOpen: boolean,
  nextDefaultOpen: boolean,
): boolean {
  return nextDefaultOpen !== previousDefaultOpen ? nextDefaultOpen : currentOpen;
}
