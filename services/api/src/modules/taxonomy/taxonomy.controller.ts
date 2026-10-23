import { Controller, Get, Inject, Query } from '@nestjs/common';
import { TaxonomyService } from './taxonomy.service';

/**
 * Reference data is PUBLIC read by design (P1-01): taxonomy tables have
 * SELECT-grant + public-read RLS policies (no user GUC), and these endpoints
 * carry no AuthGuard — the onboarding UI needs them before login.
 */

@Controller()
export class TaxonomyController {
  constructor(@Inject(TaxonomyService) private readonly taxonomy: TaxonomyService) {}

  @Get('taxonomy/religions')
  religions(@Query('locale') locale = 'en') {
    return this.taxonomy.religions(locale);
  }

  @Get('taxonomy/communities')
  communities(@Query('religion') religion: string, @Query('locale') locale = 'en') {
    return this.taxonomy.communities(religion, locale);
  }

  @Get('taxonomy/sub-communities')
  subCommunities(@Query('community') community: string, @Query('locale') locale = 'en') {
    return this.taxonomy.subCommunities(community, locale);
  }

  @Get('taxonomy/cities')
  cities(@Query('q') q?: string, @Query('locale') locale = 'en') {
    return this.taxonomy.cities(q, locale);
  }

  @Get('attributes')
  attributes(@Query('community') community?: string, @Query('locale') locale = 'en') {
    return this.taxonomy.attributeDefinitions(community, locale);
  }
}
