import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HasuraService } from '../services/hasura/hasura.service';
import { HasuraService as HasuraServiceFromServices } from '../services/hasura/hasura.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
const moment = require('moment');

@Injectable()
export class OnestStatusUpdateCron {
	constructor(
		private hasuraService: HasuraService,
		private httpService: HttpService,
		private hasuraServiceFromServices: HasuraServiceFromServices,
	) {}

	// Cronjob runs every day at 12am
	@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
	async updateOnestUserTrackStatus() {
		console.log('cron job: Onest User Update Start ');
		const getOrderIdList = `
      query MyQuery4 {
        onest_users_tracking(where: {context: {_in: ["scholarship", "jobs"]}}) {
          id
          order_id
          context
          context_item_id
          last_updated_by_cron
        }
      }
    `;

		const result = await this.hasuraService.getData({
			query: getOrderIdList,
		});

		for (const track of result.data.onest_users_tracking) {
			try {
				// Fetch bpp_id and bpp_uri
				console.log('order_id and id', track.order_id, track.id);

				const response1 = await firstValueFrom(
					this.httpService.get(
						`${process.env.ONEST_BASE_URL}/content/searchOrder/${track.order_id}`,
					),
				);

				if (response1) {
					const { bpp_id, bpp_uri } = response1.data;
					let bap_id,
						bap_uri = '',
						domain = '';
					if (track.context === 'scholarship') {
						bap_id = process.env.SCHOLARSHIP_BAP_ID;
						bap_uri = process.env.SCHOLARSHIP_BAP_URI;
						domain = process.env.SCHOLARSHIP_DOMAIN;
					} else if (track.context === 'jobs') {
						bap_id = process.env.JOB_BAP_ID;
						bap_uri = process.env.JOB_BAP_URI;
						domain = process.env.JOB_DOMAIN;
					}
					// Fetch the status using bpp_id and bpp_uri
					const response2 = await firstValueFrom(
						this.httpService.post(
							`${process.env.ONEST_BASE_URL}/status`,
							{
								context: {
									domain: domain,
									action: process.env.ACTION,
									version: process.env.VERSION,
									bap_id: bap_id,
									bap_uri: bap_uri,
									bpp_id: bpp_id,
									bpp_uri: bpp_uri,
								},
								message: {
									order_id: track.order_id,
								},
							},
						),
					);
					// console.log(
					// 	'Thirdapi---response2',
					// 	response2?.data?.responses?.[0]?.message?.order
					// 		?.fulfillments,
					// 	response2?.data?.responses?.[0]?.message?.order
					// 		?.fulfillments?.[0]?.state?.descriptor?.name,
					// );
					if (response2) {
						const name =
							response2?.data?.responses?.[0]?.message?.order
								?.fulfillments?.[0]?.state?.descriptor?.name;
						console.log('name', name);

						// Update the tracking status in the database
						const data = await this.updateTrackingStatus(
							track.id,
							name,
						);
					}
				}
			} catch (error) {
				console.error(
					`Failed to process track with order_id: ${track.order_id}`,
					error,
				);
			}
		}
	}

	public async updateTrackingStatus(id: string, name: string) {
		let queryStatus = `last_cron_reason:"Status Not Found",`;
		if (name) {
			queryStatus = `status:"${name}",`;
		}
		const mutation = `
    mutation MyMutation2 {
      update_onest_users_tracking(where:{id:{_eq:${id}}}_set:{${queryStatus}last_updated_by_cron:"${moment().format()}"})
      {
        affected_rows
      } 
    }
    `;

		const result = await this.hasuraServiceFromServices.getData({
			query: mutation,
		});
		return result;
	}
}
