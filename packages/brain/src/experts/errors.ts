/** The model or its quota is unavailable. Skills catch this and say so; nothing is fabricated. */
export class BrainUnavailableError extends Error {
  override readonly name = 'BrainUnavailableError';
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}
