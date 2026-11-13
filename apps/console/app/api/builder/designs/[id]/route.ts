import { designRequest } from '../../../../../lib/builder-server';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return designRequest(request, (await context.params).id);
}
