/** The model failed or is out of quota; nothing was emitted that could be false. */
export class CaptionUnavailableError extends Error {
  override readonly name = 'CaptionUnavailableError';
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}
