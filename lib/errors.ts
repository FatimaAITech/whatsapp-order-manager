export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function jsonError(error: unknown) {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  console.error(error);
  return Response.json(
    { error: { code: "INTERNAL", message: "Something went wrong." } },
    { status: 500 },
  );
}

export function actionError(error: unknown): { ok: false; message: string } {
  if (error instanceof AppError) {
    return { ok: false, message: error.message };
  }
  console.error(error);
  return { ok: false, message: "Something went wrong." };
}
