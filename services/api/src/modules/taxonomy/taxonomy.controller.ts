import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../identity/guards';
import { TaxonomyService } from './taxonomy.service';

@Controller()
export class TaxonomyController {
  constructor(@Inject(TaxonomyService) private readonly taxonomy: TaxonomyService) {}

  @Get('taxonomy/religions')
  @UseGuards(AuthGuard)
  religions(@Query('locale') locale = 'en') {
    return this.taxonomy.religions(locale);
  }

  @Get('taxonomy/communities')
  @UseGuards(AuthGuard)
  communities(@Query('religion') religion: string, @Query('locale') locale = 'en') {
    return this.taxonomy.communities(religion, locale);
  }

  @Get('taxonomy/sub-communities')
  @UseGuards(AuthGuard)
  subCommunities(@Query('community') community: string, @Query('locale') locale = 'en') {
    return this.taxonomy.subCommunities(community, locale);
  }

  @Get('taxonomy/cities')
  @UseGuards(AuthGuard)
  cities(@Query('q') q?: string, @Query('locale') locale = 'en') {
    return this.taxonomy.cities(q, locale);
  }

  @Get('attributes')
  @UseGuards(AuthGuard)
  attributes(@Query('community') community?: string, @Query('locale') locale = 'en') {
    return this.taxonomy.attributeDefinitions(community, locale);
  }
}
