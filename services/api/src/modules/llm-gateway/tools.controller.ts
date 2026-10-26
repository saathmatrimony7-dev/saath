/**
 * Agent tool endpoints (P1-05). A1/A2 call these with their scoped agent
 * tokens; the guard verifies signature, expiry AND that the tool is in the
 * token's allow-list. Every handler acts for claims.acting_for_user_id only —
 * a token minted for user A can never touch user B's data.
 *
 *   POST /internal/tools/get_profile_draft
 *   POST /internal/tools/save_profile_fields
 *   POST /internal/tools/get_attribute_definitions
 *   POST /internal/tools/save_dealbreakers
 *   POST /internal/tools/save_embedding (P3-01)
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ProfilesService } from '../profiles/profiles.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { patchProfileSchema, putDealbreakersSchema } from '../profiles/profiles.dto';
import { AgentTokenGuard, AGENT_CLAIMS_KEY, ToolName } from './agent-token.guard';
import type { ScopedTokenClaims } from './agent-token';

const getDraftSchema = z.object({ userId: z.string().uuid() }).strict();
const saveFieldsSchema = z.object({ userId: z.string().uuid(), fields: patchProfileSchema }).strict();
const getAttrsSchema = z.object({ community: z.string().max(64).optional() }).strict();
const saveDealbreakersToolSchema = z
  .object({ userId: z.string().uuid(), dealbreakers: putDealbreakersSchema.shape.dealbreakers })
  .strict();
const saveEmbeddingSchema = z
  .object({ userId: z.string().uuid(), vector: z.array(z.number()).length(1024) })
  .strict();

type AuthedRequest = Request & { [AGENT_CLAIMS_KEY]?: ScopedTokenClaims };

@Controller('internal/tools')
@UseGuards(AgentTokenGuard)
export class ToolsController {
  constructor(
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
    @Inject(TaxonomyService) private readonly taxonomy: TaxonomyService,
  ) {}

  /** Token must be bound to exactly the user named in the body. */
  private assertBinding(req: AuthedRequest, userId: string): void {
    const claims = req[AGENT_CLAIMS_KEY];
    if (!claims || claims.acting_for_user_id !== userId) {
      throw new ForbiddenException('token not bound to this user');
    }
  }

  @Post('get_profile_draft')
  @HttpCode(HttpStatus.OK)
  @ToolName('get_profile_draft')
  getDraft(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(getDraftSchema)) body: { userId: string },
  ) {
    this.assertBinding(req, body.userId);
    return this.profiles.getProfile(body.userId);
  }

  @Post('save_profile_fields')
  @HttpCode(HttpStatus.OK)
  @ToolName('save_profile_fields')
  saveFields(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(saveFieldsSchema))
    body: { userId: string; fields: z.infer<typeof patchProfileSchema> },
  ) {
    this.assertBinding(req, body.userId);
    return this.profiles.patchProfile(body.userId, body.fields);
  }

  @Post('get_attribute_definitions')
  @HttpCode(HttpStatus.OK)
  @ToolName('get_attribute_definitions')
  getAttributeDefinitions(
    @Body(new ZodValidationPipe(getAttrsSchema)) body: { community?: string },
  ) {
    // Neutral read of public reference data; no user binding required.
    return this.taxonomy.attributeDefinitions(body.community, 'en');
  }

  @Post('save_dealbreakers')
  @HttpCode(HttpStatus.OK)
  @ToolName('save_dealbreakers')
  saveDealbreakers(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(saveDealbreakersToolSchema))
    body: { userId: string; dealbreakers: z.infer<typeof putDealbreakersSchema>['dealbreakers'] },
  ) {
    this.assertBinding(req, body.userId);
    return this.profiles.putDealbreakers(body.userId, { dealbreakers: body.dealbreakers });
  }

  /** A2 (P3-01): persist the profile embedding of the normalised summary. */
  @Post('save_embedding')
  @HttpCode(HttpStatus.OK)
  @ToolName('save_embedding')
  saveEmbedding(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(saveEmbeddingSchema))
    body: { userId: string; vector: number[] },
  ) {
    this.assertBinding(req, body.userId);
    return this.profiles.saveEmbedding(body.userId, body.vector);
  }
}
