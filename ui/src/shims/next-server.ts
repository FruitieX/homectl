export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit) {
    return Response.json(body, init);
  }
}