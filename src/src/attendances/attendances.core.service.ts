import { Injectable } from '@nestjs/common';
import { HasuraService } from 'src/hasura/hasura.service';
import { HasuraService as HasuraServiceFromServices } from '../services/hasura/hasura.service';

@Injectable()
export class AttendancesCoreService {
	constructor(
		private readonly hasuraService: HasuraService,
		private hasuraServiceFromServices: HasuraServiceFromServices,
	) {}
	public async create(body: any, returnFields: any, req: any, res: any) {
		let response = await this.hasuraService.q(
			'attendance',
			{
				...body,
			},
			[],
			false,
			[...returnFields],
		);

		return response;
	}

	public async update(
		body: any,
		id: any,
		update_array: any,
		returnFields: any,
		req: any,
		res: any,
	) {
		let response = await this.hasuraService.q(
			'attendance',
			{
				...body,
				id: id,
			},
			update_array,
			true,
			[...returnFields],
		);

		return response;
	}

	public async getByCampId(
		id: any,

		req: any,
		res: any,
	) {
		let query = `query MyQuery {
			attendance(where: {context_id: {_eq:${id}}}){
			  status
			  fa_is_processed
			  fa_similarity_percentage
			  user{
				id
				first_name
				middle_name
				last_name
			  }
			}
		  }
		  `;

		const hasura_response = await this.hasuraServiceFromServices.getData({
			query: query,
		});

		return hasura_response;
	}

	// findAll(request: any) {
	// 	return this.hasuraService.getAll(
	// 		this.table,
	// 		this.returnFields,
	// 		request,
	// 	);
	// }

	// findOne(id: number) {
	// 	return this.hasuraService.getOne(+id, this.table, this.returnFields);
	// }

	// update(id: number, req: any) {
	// 	return this.hasuraService.update(
	// 		+id,
	// 		this.table,
	// 		req,
	// 		this.returnFields,
	// 	);
	// }
}
