import fastifyPlugin from 'fastify-plugin';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '@taskmaster/db';
import { z } from 'zod';

export const errorHandlerPlugin = fastifyPlugin(async (fastify: FastifyInstance) => {
  // Set a generic error handler for all routes
  fastify.setErrorHandler((error: any, request: FastifyRequest, reply: FastifyReply) => {
    // Handle Zod validation errors
    if (error instanceof z.ZodError || (error.errors && Array.isArray(error.errors) && error.errors[0] instanceof z.ZodError)) {
      const zodErrors = error.errors?.length ? error.errors : [error];
      reply.status(400).send({
        errors: zodErrors.map((e: any) => ({
          code: 'BAD_REQUEST',
          message: e.message || 'Validation error',
          details: e.path ? e.path.join('.') : undefined,
        })),
      });
      return;
    }

    // Handle ApiError instances
    if (error instanceof ApiError) {
      reply.status(error.status).send({
        errors: [{ code: error.code, message: error.message }],
      });
      return;
    }

    // Handle known errors with status/code
    if (error.status && error.code) {
      reply.status(error.status).send({
        errors: [{ code: error.code, message: error.message || String(error) }],
      });
      return;
    }

    // Handle generic errors - log and return sanitized 500
    request.log.error({ err: error }, 'Unhandled request error');
    reply.status(500).send({
      errors: [{ code: 'INTERNAL_ERROR', message: 'An internal error occurred' }],
    });
  });
});
