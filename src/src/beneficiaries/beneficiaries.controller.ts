import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Put,
	Query,
	Req,
	Res,
	UseGuards,
	UseInterceptors,
	UsePipes,
	ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { SentryInterceptor } from 'src/common/interceptors/sentry.interceptor';
import { AuthGuard } from 'src/modules/auth/auth.guard';
import { BeneficiariesService } from './beneficiaries.service';
import { RegisterBeneficiaryDto } from './dto/register-beneficiary.dto';
import { StatusUpdateDTO } from './dto/status-update.dto';

@UseInterceptors(SentryInterceptor)
@Controller('beneficiaries')
export class BeneficiariesController {
	constructor(private beneficiariesService: BeneficiariesService) {}

	// @Get('/list')
	// public async getAgList(
	//   @Body() request: Record<string, any>,
	//   @Req() req:any
	// ) {
	//    return this.beneficiariesService.getAgList(request,req);
	// }

	// @Post('/create')
	// create(@Body() createEventDto: CreateEventDto) {
	//   return this.beneficiariesService.create(createEventDto);
	// }

	@Post()
	@UseGuards(new AuthGuard())
	findAll(
		@Body() request: Record<string, any>,
		@Req() req: any,
		@Res() response: Response,
	) {
		return this.beneficiariesService.findAll(request, req, response);
	}

	@Post('/admin/list/duplicates-by-aadhaar')
	@UseGuards(new AuthGuard())
	async getBeneficiariesDuplicatesByAadhaar(
		@Body() body: Record<string, any>,
		@Query() query: any,
		@Res() response: Record<string, any>,
	) {
		const aadhaarNo = body.aadhar_no;
		const limit = !isNaN(parseInt(query.limit)) ? parseInt(query.limit) : 0;
		const page =
			!isNaN(parseInt(query.page)) && parseInt(query.page) > 0
				? parseInt(query.page)
				: 1;
		const skip = limit * (page - 1);
		const resultPayload =
			await this.beneficiariesService.getBeneficiariesDuplicatesByAadhaar(
				aadhaarNo,
				limit,
				skip,
			);
		if (resultPayload.success) {
			return response.status(200).json(resultPayload);
		} else {
			return response.status(200).json({
				success: false,
				message: 'Error while fetching results',
			});
		}
	}

	@Post('admin/list/deactivate-duplicates')
	@UseGuards(new AuthGuard())
	async deactivateDuplicateBeneficiaries(
		@Body() body: Record<string, any>,
		@Req() req: any,
		@Res() response: Record<string, any>,
	) {
		const roles = req.mw_roles;
		let duplicateArr;
		// Fetch aadhar number of user to set as active
		const aadhar_no = (
			await this.beneficiariesService.findOne(+body.activeId)
		)?.data?.aadhar_no;

		// Fetch valid duplication list of the token user
		if (roles.includes('program_owner')) {
			duplicateArr = (
				await this.beneficiariesService.getAllDuplicatesUnderPo()
			).data;
		} else if (roles.includes('staff')) {
			duplicateArr = (
				await this.beneficiariesService.getAllDuplicatesUnderIp(
					req.mw_userid,
				)
			).data;
		}

		// Check if the Aadhaar number exists or not in the list
		if (
			!duplicateArr.some(
				(aadhaarData) => aadhaarData.aadhar_no == aadhar_no,
			)
		) {
			return response.status(400).json({
				success: false,
				message: 'Invalid Aadhaar!',
			});
		}

		// Set other AGs as deactivated and set is_duplicate flag to false
		const { success, data: updateData } =
			await this.beneficiariesService.deactivateDuplicateBeneficiaries(
				aadhar_no,
				+body.activeId,
				req.mw_userid,
			);

		return response.status(200).json({
			success: success,
			data: updateData,
		});
	}

	@Post('/admin/list')
	@UseGuards(new AuthGuard())
	findAllBeneficiariesForIp(
		@Body() request: Record<string, any>,
		@Req() req: any,
		@Res() response: Response,
	) {
		return this.beneficiariesService.getList(request, req, response);
	}

	@Post('/:id/is_enrollment_exists')
	@UseGuards(new AuthGuard())
	async isEnrollmentNumberExists(
		@Param('id') id: string,
		@Body() body: Record<string, any>,
		@Res() response: Response,
	) {
		const result = await this.beneficiariesService.isEnrollmentNumberExists(
			id,
			body,
		);
		return response.status(result.success ? 200 : 422).json(result);
	}

	@Get('/getStatuswiseCount')
	getStatuswiseCount(@Req() request: any, @Res() response: Response) {
		return this.beneficiariesService.getStatuswiseCount(request, response);
	}

	@Get('admin/list/duplicates-count-by-aadhaar')
	@UseGuards(new AuthGuard())
	async getAllDuplicateCountsByAadhaar(
		@Req() request: any,
		@Query() query: any,
		@Res() response: any,
	) {
		const roles = request.mw_roles;

		const limit = !isNaN(parseInt(query.limit)) ? parseInt(query.limit) : 0;
		const page =
			!isNaN(parseInt(query.page)) && parseInt(query.page) > 0
				? parseInt(query.page)
				: 1;
		const skip = limit * (page - 1);
		// Fetch duplicate counts based on role
		let resultPayload;
		if (roles.includes('program_owner')) {
			resultPayload =
				await this.beneficiariesService.getAllDuplicatesUnderPo(
					limit,
					skip,
				);
		} else if (roles.includes('staff')) {
			resultPayload =
				await this.beneficiariesService.getAllDuplicatesUnderIp(
					request.mw_userid,
					limit,
					skip,
				);
		}
		return response.status(200).json(resultPayload);
	}

	@Get(':id')
	@UseGuards(new AuthGuard())
	findOne(@Param('id') id: string, @Res() response: Response) {
		return this.beneficiariesService.findOne(+id, response);
	}

	@Delete(':id')
	remove(@Param('id') id: string) {
		return this.beneficiariesService.remove(+id);
	}

	@Post('/register')
	@UsePipes(ValidationPipe)
	private async registerBeneficiary(
		@Body() body: RegisterBeneficiaryDto,
		@Req() request: any,
	) {
		return this.beneficiariesService.registerBeneficiary(body, request);
	}

	@Patch(':id')
	@UseGuards(new AuthGuard())
	public async updateBeneficiary(
		@Param('id') id: string,
		@Body() req: Record<string, any>,
		@Req() request: any,
		@Res() response: any,
	) {
		return this.beneficiariesService.create(
			{ ...req, id: id },
			request,
			response,
			true,
		);
	}

	@Put('statusUpdate')
	@UseGuards(new AuthGuard())
	@UsePipes(ValidationPipe)
	async statusUpdate(
		@Body() body: StatusUpdateDTO,
		@Res() response: any,
		@Req() request: any,
	) {
		const result = await this.beneficiariesService.statusUpdate(
			body,
			request,
		);
		return response.status(result.status).json({
			success: result.success,
			message: result.message,
			data: result.data,
		});
	}

	@Post(':id/verify-enrollment/:action')
	@UseGuards(new AuthGuard())
	async verifyEnrollment(
		@Body() body:any,
		@Res() response: any,
		@Req() request: any,
		@Param() params:any
	) {
		let result 
		if(params.action =="Verified"){
			const payload = {
				user_id:params.id,
				status:"enrolled_ip_verified"
			}
            result = await this.beneficiariesService.statusUpdate(
			payload,
			request,
		);
		}
		else if(params.action =="Rejected"){
			
            result = await this.beneficiariesService.setEnrollmentStatusRejected(
			params.id,
			request.mw_userid,
		);
		}
		
		return response.status(result.status).json({
			success: result.success,
			message: result.message,
			data: result.data,
		});
	}

	@Post('/admin/export-csv')
	@UseGuards(new AuthGuard())
	async exportCsv(
		@Req() request: any,
		@Body() body: any,
		@Res() response: any,
	) {
		return this.beneficiariesService.exportCsv(request, body, response);
	}

	@Post('/admin/export-subjects-csv')
	@UseGuards(new AuthGuard())
	async exportSubjectsCsv(
		@Req() request: any,
		@Body() body: any,
		@Res() response: any,
	) {
		return this.beneficiariesService.exportSubjectCsv(
			request,
			body,
			response,
		);
	}
}
