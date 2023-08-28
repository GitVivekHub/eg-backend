import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Req,
	Res,
	UseGuards,
	UseInterceptors,
	UsePipes,
	ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { SentryInterceptor } from 'src/common/interceptors/sentry.interceptor';
import { AuthGuard } from '../modules/auth/auth.guard';
import { FilterFacilitatorDto } from './dto/filter-facilitator.dto';
import { FacilitatorService } from './facilitator.service';

@UseInterceptors(SentryInterceptor)
@Controller('/facilitators')
export class FacilitatorController {
	public url = process.env.HASURA_BASE_URL;
	constructor(public facilitatorService: FacilitatorService) {}

	// @Post('/create')
	// create(@Body() createFacilitatorDto: CreateFacilitatorDto) {
	//   return this.facilitatorService.create(createFacilitatorDto);
	// }

	// @Post()
	// findAll(@Body() request: Record<string, any>) {
	//   return this.facilitatorService.findAll(request);
	// }

	// @Get(':id')
	// findOne(@Param('id') id: string) {
	//   return this.facilitatorService.findOne(+id);
	// }

	// @Patch(':id')
	// update(@Param('id') id: string, @Body() request: Record<string, any>) {
	//   return this.facilitatorService.update(+id, request);
	// }

	@Get('/getStatuswiseCount')
	@UseGuards(new AuthGuard())
	getStatuswiseCount(@Req() request: any, @Res() response: Response) {
		return this.facilitatorService.getStatuswiseCount(request, response);
	}

	@Post('/forOrientation')
	@UseGuards(new AuthGuard())
	async getFacilitatorsForOrientation(
		@Req() request: any,
		@Body() body: any,
		@Res() response: any,
	) {
		return this.facilitatorService.getFacilitatorsForOrientation(
			request,
			body,
			response,
		);
	}

	@Delete('/experience/:id')
	@UseGuards(new AuthGuard())
	removeExperience(
		@Param('id') id: string,
		@Req() request: any,
		@Res() response: any,
	) {
		return this.facilitatorService.removeExperience(+id, request, response);
	}

	@Patch(':id')
	@UseGuards(new AuthGuard())
	update(
		@Param('id') id: string,
		@Body() body: Record<string, any>,
		@Res() response: any,
	) {
		return this.facilitatorService.update(+id, body, response);
	}

	@Post('/')
	@UsePipes(ValidationPipe)
	async getFacilitators(
		@Req() req: any,
		@Body() body: FilterFacilitatorDto,
		@Res() response: any,
	) {
		return this.facilitatorService.getFacilitators(req, body, response);
	}

	@Post('/admin/learner-status-distribution')
	@UsePipes(ValidationPipe)
	async getLearnerStatusDistribution(
		@Req() req: any,
		@Body() body: FilterFacilitatorDto,
		@Res() response: any,
	) {
		return this.facilitatorService.getLearnerStatusDistribution(req, body, response);
	}


	@Post('/exportCsv')
	@UseGuards(new AuthGuard())
	@UsePipes(ValidationPipe)
	async exportFileToCsv(
		@Req() request: any,
		@Body() body: FilterFacilitatorDto,
		@Res() response: any,
	) {
		return this.facilitatorService.exportFileToCsv(request, body, response);
	}
}
