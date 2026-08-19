import { Component, OnInit, Inject, OnDestroy, ViewChild } from '@angular/core';
import { MatDialogRef as MatDialogRef, MAT_DIALOG_DATA as MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatExpansionPanel } from '@angular/material/expansion';
import { Subscription, delay } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';

import { EndPointSettings, HmiService } from '../../_services/hmi.service';
import { AppService } from '../../_services/app.service';
import { ProjectService } from '../../_services/project.service';
import { DeviceType, DeviceSecurity, MessageSecurityMode, SecurityPolicy, ModbusOptionType, ModbusReuseModeType, RedisReadModeType, RedisOptions, Tag, TAG_PREFIX } from './../../_models/device';
import { Utils } from '../../_helpers/utils';

const T2M_STATUS_TAGS = [
	{ address: 'automator.alive', name: 'automator_alive', label: 'Automator reachable', type: 'boolean' },
	{ address: 'ecatcher.running', name: 'ecatcher_running', label: 'eCatcher running', type: 'boolean' },
	{ address: 'ecatcher.connected_site', name: 'ecatcher_connected_site', label: 'Connected site', type: 'string' },
	{ address: 'sites.online_count', name: 'sites_online_count', label: 'Online sites', type: 'number' },
	{ address: 'cycle.state', name: 'cycle_state', label: 'Collection state', type: 'string' },
	{ address: 'cycle.site', name: 'cycle_site', label: 'Collection site', type: 'string' },
	{ address: 'cycle.required_tags', name: 'cycle_required_tags', label: 'Required tags', type: 'number' },
	{ address: 'cycle.updated_tags', name: 'cycle_updated_tags', label: 'Fresh tags', type: 'number' },
	{ address: 'cycle.last_success_at', name: 'cycle_last_success_at', label: 'Last success timestamp', type: 'number' },
	{ address: 'cycle.last_error', name: 'cycle_last_error', label: 'Last collection error', type: 'string' }
];

@Component({
	selector: 'app-device-property',
	templateUrl: './device-property.component.html',
	styleUrls: ['./device-property.component.scss']
})
export class DevicePropertyComponent implements OnInit, OnDestroy {

	// @Input() name: any;
	@ViewChild('panelProperty', {static: false}) panelProperty: MatExpansionPanel;
	@ViewChild('panelCertificate', {static: false}) panelCertificate: MatExpansionPanel;

	tableRadio: any;
	databaseTables = [];

	securityRadio: any;
	mode: any;
	deviceType: any = {};
	showPassword: boolean;

	pollingPlcType = [{text: '50 ms', value: 50},
		              {text: '100 ms', value: 100},
		              {text: '200 ms', value: 200},
					  {text: '350 ms', value: 350},
					  {text: '500 ms', value: 500},
					  {text: '700 ms', value: 700},
					  {text: '1 sec', value: 1000},
					  {text: '1.5 sec', value: 1500},
					  {text: '2 sec', value: 2000},
					  {text: '3 sec', value: 3000},
					  {text: '4 sec', value: 4000},
					  {text: '5 sec', value: 5000},
					  {text: '10 sec', value: 10000},
					  {text: '30 sec', value: 30000},
					  {text: '1 min', value: 60000}];

	pollingWebApiType = [{text: '1 sec', value: 1000},
						 {text: '2 sec', value: 2000},
						 {text: '3 sec', value: 3000},
						 {text: '5 sec', value: 5000},
						 {text: '10 sec', value: 10000},
						 {text: '30 sec', value: 30000},
						 {text: '1 min', value: 60000},
						 {text: '2 min', value: 60000 * 2},
						 {text: '5 min', value: 60000 * 5},
						 {text: '10 min', value: 60000 * 10},
						 {text: '30 min', value: 60000 * 30},
						 {text: '60 min', value: 60000 * 60}];

    pollingWebCamType = this.pollingWebApiType.concat([{text: 'Disabled', value: -1}]);

	pollingType = this.pollingPlcType;

	isFuxaServer = false;
	isToRemove = false;
	propertyError = '';
	propertyExpanded: boolean;
	propertyLoading: boolean;
	securityMode: any = [];
	security = new DeviceSecurity();
	baudrateType = [110, 300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 115200, 128000, 256000, 921600 ];
	databitsType = [7, 8];
	stopbitsType = [1, 1.5, 2];
	parityType = ['None', 'Odd', 'Even'];
	methodType = ['GET'];//, 'POST'];
	parserType = ['JSON'];//, 'CSV'];
	hostInterfaces = [];
	modbusRtuOptionType = [ModbusOptionType.SerialPort, ModbusOptionType.RTUBufferedPort, ModbusOptionType.AsciiPort];
	modbusTcpOptionType = [ModbusOptionType.TcpPort, ModbusOptionType.UdpPort, ModbusOptionType.TcpRTUBufferedPort, ModbusOptionType.TelnetPort];
	modbusReuseModeType = ModbusReuseModeType;
    redisReadModeType = RedisReadModeType;
    redisReadModeSimple = RedisReadModeType.simple;
    redisReadModeHash = RedisReadModeType.hash;
    // redisReadModeCustom = RedisReadModeType.custom;
	redisOptions = new RedisOptions();
	writeArgsTooltip = '';
	result = '';
	t2mSites: any[] = [];
	private subscriptionDeviceProperty: Subscription;
	private subscriptionHostInterfaces: Subscription;
	private subscriptionDeviceWebApiRequest: Subscription;

    private projectService: ProjectService;

	constructor(
		private hmiService: HmiService,
        private translateService: TranslateService,
        private appService: AppService,
		public dialogRef: MatDialogRef<DevicePropertyComponent>,
		@Inject(MAT_DIALOG_DATA) public data: any) {
            this.projectService = data.projectService;
        }

	ngOnInit() {
		this.isToRemove = this.data.remove;
		this.isFuxaServer = (this.data.device.type && this.data.device.type === DeviceType.FuxaServer) ? true : false;
		for (let key in DeviceType) {
			if (!this.isFuxaServer && key !== DeviceType.FuxaServer) {
				for (let idx = 0; idx < this.data.availableType.length; idx++) {
					if (key.startsWith(this.data.availableType[idx])) {
						this.deviceType[key] = DeviceType[key];
					}
				}
			}
		}
		// set default is only one type
		if (this.data.availableType.length === 1) {
			this.data.device.type = this.data.availableType[0];
		}

		this.subscriptionDeviceProperty = this.hmiService.onDeviceProperty.subscribe(res => {
			if (res.type === DeviceType.OPCUA) {
				this.securityMode = [];
				if (res.result) {
					let secPol = SecurityPolicy;
					for (let idx = 0; idx < res.result.length; idx++) {
						let sec = res.result[idx];
						let mode = this.securityModeToString(sec.securityMode);
						if (sec.securityPolicy.indexOf(secPol.None) !== -1) {
							this.securityMode.push({value: sec, text: SecurityPolicy.None.toString() + ' - ' + mode});
						} else if (sec.securityPolicy.indexOf(secPol.Basic128Rsa15) !== -1) {
							this.securityMode.push({value: sec, text: SecurityPolicy.Basic128Rsa15.toString() + ' - ' + mode});
						} else if (sec.securityPolicy.indexOf(secPol.Basic128) !== -1) {
							this.securityMode.push({value: sec, text: SecurityPolicy.Basic128.toString() + ' - ' + mode});
						} else if (sec.securityPolicy.indexOf(secPol.Basic192Rsa15) !== -1) {
							this.securityMode.push({value: sec, text: SecurityPolicy.Basic192Rsa15.toString() + ' - ' + mode});
						} else if (sec.securityPolicy.indexOf(secPol.Basic192) !== -1) {
							this.securityMode.push({value: sec, text: SecurityPolicy.Basic192.toString() + ' - ' + mode});
						} else if (sec.securityPolicy.indexOf(secPol.Basic256Rsa15) !== -1) {
							this.securityMode.push({value: sec, text: SecurityPolicy.Basic256Rsa15.toString() + ' - ' + mode});
						} else if (sec.securityPolicy.indexOf(secPol.Basic256Sha256) !== -1) {
							this.securityMode.push({value: sec, text: SecurityPolicy.Basic256Sha256.toString() + ' - ' + mode});
						} else if (sec.securityPolicy.indexOf(secPol.Basic256) !== -1) {
							this.securityMode.push({value: sec, text: SecurityPolicy.Basic256.toString() + ' - ' + mode});
						} else if (sec.securityPolicy.indexOf(secPol.Aes128_Sha256_RsaOaep) !== -1) {
							this.securityMode.push({value: sec, text: SecurityPolicy.Aes128_Sha256_RsaOaep.toString() + ' - ' + mode});
						} else if (sec.securityPolicy.indexOf(secPol.Aes256_Sha256_RsaPss) !== -1) {
							this.securityMode.push({value: sec, text: SecurityPolicy.Aes256_Sha256_RsaPss.toString() + ' - ' + mode});
						}
						if (this.isSecurityMode(sec)) {
							this.securityRadio = sec;
						}
					}
					this.propertyError = '';
				} else if (res.error) {
					this.propertyError = res.error;
				}
			} else if (res.type === DeviceType.BACnet) {
			} else if (res.type === DeviceType.ODBC) {
				if (res?.error) {
					this.propertyError = res.error;
				} else {
					this.databaseTables = res.result;
					for (let idx = 0; idx < res.result?.length; idx++) {
						if (this.isSecurityMode(res.result[idx])) {
							this.tableRadio = res.result[idx];
						}
					}
					this.propertyError = '';
				}
			} else if (res.type === DeviceType.T2MAutomator) {
				if (res.result) {
					this.t2mSites = res.result.sites || res.result.Sites || [];
					this.patchT2MSites();
					this.propertyError = '';
				} else if (res.error) {
					this.propertyError = res.error;
				}
			}
			this.propertyLoading = false;
		});
		// check security
		if (this.data.device.id && (this.data.device.type === DeviceType.OPCUA || this.data.device.type === DeviceType.MQTTclient
			|| this.data.device.type === DeviceType.ODBC)) {
			this.projectService.getDeviceSecurity(this.data.device.id).pipe(
				delay(500)
			).subscribe(result => {
				if (result) {
					this.setSecurity(result.value);
				}
			}, err => {
				console.error('get Device Security err: ' + err);
			});
		}

        if (this.data.device.property) {
            if (!this.data.device.property.baudrate) {
                this.data.device.property.baudrate = 9600;
            }
            if (!this.data.device.property.databits) {
                this.data.device.property.databits = 8;
            }
            if (!this.data.device.property.stopbits) {
                this.data.device.property.stopbits = 1;
            }
            if (!this.data.device.property.parity) {
                this.data.device.property.parity = 'None';
            }
            if (!this.data.device.property.forceFC16) {
                this.data.device.property.forceFC16 = false;
            }
        }
		if (this.data.device.type === DeviceType.REDIS) {
			const opts = this.data.device?.property?.options;
			this.redisOptions = (typeof opts === 'string')
			  ? new RedisOptions()
			  : (opts || new RedisOptions());
		}
		if (this.data.device.type === DeviceType.T2MAutomator) {
			this.ensureT2MDefaults();
		}
		this.subscriptionHostInterfaces = this.hmiService.onHostInterfaces.subscribe(res => {
			if (res.result) {
				this.hostInterfaces = res;
			}
		});
		this.subscriptionDeviceWebApiRequest = this.hmiService.onDeviceWebApiRequest.subscribe(res => {
			if (res.result) {
				this.result = JSON.stringify(res.result);
			}
			this.propertyLoading = false;
		});
		this.writeArgsTooltip = this.translateService.instant('device.property-redis-write-args-tooltip');
		this.onDeviceTypeChanged();
	}

	ngOnDestroy() {
		try {
			if (this.subscriptionDeviceProperty) {
				this.subscriptionDeviceProperty.unsubscribe();
			}
			if (this.subscriptionHostInterfaces) {
				this.subscriptionHostInterfaces.unsubscribe();
			}
			if (this.subscriptionDeviceWebApiRequest) {
				this.subscriptionDeviceWebApiRequest.unsubscribe();
			}
		} catch (err) {
			console.error(err);
		}
	}

	onNoClick(): void {
		this.dialogRef.close();
	}

	onOkClick(): void {
		if (this.data.device.type === DeviceType.T2MAutomator) {
			this.syncT2MSiteTags();
		}
		this.data.security = this.getSecurity();
		if (this.data.device.type === DeviceType.REDIS) {
			this.data.device.property.options = this.redisOptions;
		}
	}

	onCheckOpcUaServer() {
		this.propertyLoading = true;
        this.propertyError = '';
		this.hmiService.askDeviceProperty(this.data.device.property.address, this.data.device.type);
	}

	onCheckWebApi() {
		this.propertyLoading = true;
		this.result = '';
		this.hmiService.askWebApiProperty(this.data.device.property);
	}

	onCheckOdbc() {
		this.propertyLoading = true;
		this.result = '';
		this.hmiService.askDeviceProperty(<EndPointSettings> {
			address: this.data.device.property.address,
			uid: this.security.username,
			pwd: this.security.password,
			id: this.data.device.id
		}, this.data.device.type);
	}

	onCheckT2M() {
		this.propertyLoading = true;
		this.propertyError = '';
		this.hmiService.askDeviceProperty({
			address: this.data.device.property.address,
			apiToken: this.data.device.property.apiToken
		}, this.data.device.type);
	}

	// onCheckBACnetDevice() {
	// 	this.propertyLoading = true;
	// 	this.hmiService.askDeviceProperty(this.data.device.property.address, this.data.device.type);
	// }

	onPropertyExpand(status) {
		this.propertyExpanded = status;
	}

	onAddressChanged() {
		this.propertyLoading = false;
	}

	onDeviceTypeChanged() {
		if (this.data.device.type === DeviceType.WebAPI ) {
			this.pollingType = this.pollingWebApiType;
		} else if (this.data.device.type === DeviceType.WebCam) {
            this.pollingType = this.pollingWebCamType;
        } else {
			this.pollingType = this.pollingPlcType;
		}
		if (this.data.device.type === DeviceType.Kawasaki) {
			if (!this.data.device.polling || this.data.device.polling < 3000) {
				this.data.device.polling = 3000;
			}
			if (!this.data.device.property.port) {
				this.data.device.property.port = 23;
			}
			if (!this.data.device.property.loginCommand) {
				this.data.device.property.loginCommand = 'as';
			}
			if (!this.data.device.property.readyMarker) {
				this.data.device.property.readyMarker = '>';
			}
			if (!this.data.device.property.timeoutMs) {
				this.data.device.property.timeoutMs = 10000;
			}
			if (this.data.device.property.opeinfo === undefined) {
				this.data.device.property.opeinfo = true;
			}
		} else if (this.data.device.type === DeviceType.T2MAutomator) {
			this.ensureT2MDefaults();
		}
	}

	addT2MMapping() {
		this.ensureT2MDefaults();
		this.data.device.property.mappings.push({
			enabled: true,
			site: '',
			connections: [],
			requiredTags: []
		});
	}

	removeT2MMapping(index: number) {
		this.data.device.property.mappings.splice(index, 1);
	}

	selectAllT2MTags(mapping) {
		mapping.requiredTags = this.getT2MAvailableTags(mapping).map(tag => tag.id);
	}

	getT2MAvailableTags(mapping) {
		const connections = new Set(mapping.connections || []);
		if (!connections.size) {
			return [];
		}
		return (this.data.availableTags || [])
			.filter(tag => connections.has(tag.deviceName));
	}

	onT2MConnectionsChanged(mapping, connections) {
		mapping.connections = Array.isArray(connections) ? connections : [];
		const availableTagIds = new Set(this.getT2MAvailableTags(mapping).map(tag => tag.id));
		mapping.requiredTags = (mapping.requiredTags || [])
			.filter(tagId => availableTagIds.has(tagId));
	}

	selectAllT2MStatusSites() {
		this.ensureT2MDefaults();
		this.data.device.property.statusSites = Array.from(new Set(
			this.t2mSites.map(site => site.name).filter(name => !!name)));
	}

	clearT2MStatusSites() {
		this.ensureT2MDefaults();
		this.data.device.property.statusSites = [];
	}

	private patchT2MSites() {
		this.ensureT2MDefaults();
		this.t2mSites.filter(site => site.enabled !== false).forEach(site => {
			const exists = this.data.device.property.mappings.some(mapping =>
				String(mapping.site || '').toLowerCase() === String(site.name || '').toLowerCase());
			if (!exists) {
				this.data.device.property.mappings.push({
					enabled: true,
					site: site.name,
					connections: [],
					requiredTags: []
				});
				this.data.device.property.statusSites.push(site.name);
			}
		});
		this.data.device.property.statusSites = Array.from(new Set(
			this.data.device.property.statusSites.filter(name => !!name)));
		this.syncT2MSiteTags();
	}

	private ensureT2MDefaults() {
		const property = this.data.device.property;
		this.data.device.tags = this.data.device.tags || {};
		T2M_STATUS_TAGS.forEach(definition => this.ensureT2MTag(definition));
		property.address = property.address || 'http://127.0.0.1:17831';
		property.autoCycle = property.autoCycle !== false;
		property.commandTimeoutSeconds = Number(property.commandTimeoutSeconds) || 120;
		property.collectionTimeoutSeconds = Number(property.collectionTimeoutSeconds) || 90;
		property.cycleDelaySeconds = Number(property.cycleDelaySeconds) || 300;
		property.failureDelaySeconds = Number(property.failureDelaySeconds) || 5;
		property.mappings = Array.isArray(property.mappings) ? property.mappings : [];
		property.mappings.forEach(mapping => {
			mapping.connections = Array.isArray(mapping.connections) ? mapping.connections : [];
			mapping.requiredTags = Array.isArray(mapping.requiredTags) ? mapping.requiredTags : [];
		});
		if (!Array.isArray(property.statusSites)) {
			property.statusSites = Array.from(new Set(property.mappings
				.map(mapping => mapping.site)
				.filter(site => !!site)));
		}
		if (!this.data.device.polling || this.data.device.polling < 3000) {
			this.data.device.polling = 3000;
		}
	}

	private syncT2MSiteTags() {
		this.ensureT2MDefaults();
		const selectedSites: string[] = Array.from(new Set<string>(
			this.data.device.property.statusSites
				.map(name => String(name || '').trim())
				.filter(name => !!name)));
		const selectedAddresses = new Set(selectedSites.map(name =>
			`site.${this.t2mSafeName(name)}.online`));

		Object.keys(this.data.device.tags || {}).forEach(id => {
			const address = String(this.data.device.tags[id]?.address || '');
			if (address.startsWith('site.') && address.endsWith('.online')
				&& !selectedAddresses.has(address)) {
				delete this.data.device.tags[id];
			}
		});

		selectedSites.forEach(name => this.ensureT2MTag({
			address: `site.${this.t2mSafeName(name)}.online`,
			name: `site_${this.t2mSafeName(name)}_online`,
			label: `${name} online`,
			type: 'boolean'
		}));
		this.data.device.property.statusSites = selectedSites;
	}

	private ensureT2MTag(definition) {
		const exists = Object.values(this.data.device.tags || {}).some((tag: any) =>
			tag.address === definition.address);
		if (exists) {
			return;
		}
		const tag = new Tag(Utils.getGUID(TAG_PREFIX));
		tag.address = definition.address;
		tag.name = definition.name;
		tag.label = definition.label;
		tag.description = definition.label;
		tag.type = definition.type;
		this.data.device.tags[tag.id] = tag;
	}

	private t2mSafeName(value: string): string {
		const text = String(value || '').trim().toLowerCase();
		const slug = text.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'site';
		let hash = 2166136261;
		for (let index = 0; index < text.length; index++) {
			hash ^= text.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return `${slug}_${(hash >>> 0).toString(16)}`;
	}

	isValid(device): boolean {
        if (!device.name || !device.type) {
            return false;
        }
		return (this.data.exist.find((n) => n === device.name)) ? false : true;
	}

	isSecurityMode(sec) {
		if (JSON.stringify(this.mode) === JSON.stringify(sec)) {
			return true;
		} else {
			return false;
		}
	}

	getSecurity(): DeviceSecurityGeneral {
		if (this.propertyExpanded && this.data.device.type === DeviceType.OPCUA) {
			if (this.securityRadio || this.security.username || this.security.password) {
				let result = <DeviceSecurityGeneral>{
					mode: this.securityRadio,
					uid: this.security.username,
					pwd: this.security.password
				};
				return result;
			}
		} else if (this.propertyExpanded && this.data.device.type === DeviceType.MQTTclient) {
			if (this.security.clientId || this.security.username || this.security.password || this.security.certificateFileName ||
				this.security.privateKeyFileName || this.security.caCertificateFileName) {
				let result = <DeviceSecurityGeneral>{
					clientId: this.security.clientId,
					uid: this.security.username,
					pwd: this.security.password,
					cert: this.security.certificateFileName,
					pkey: this.security.privateKeyFileName,
					caCert: this.security.caCertificateFileName
				};
				return result;
			}
		} else if (this.data.device.type === DeviceType.ODBC) {
			if (this.tableRadio || this.security.username || this.security.password) {
				let result = <DeviceSecurityGeneral>{
					mode: this.tableRadio,
					uid: this.security.username,
					pwd: this.security.password
				};
				return result;
			}
		}
		return null;
	}

	setSecurity(security: string) {
		if (security && security !== 'null') {
			let value = <DeviceSecurityGeneral>JSON.parse(security);
			this.mode = value.mode;
			this.security.username = value.uid;
			this.security.password = value.pwd;
			this.security.clientId = value.clientId;
			this.security.grant_type = value.gt;
			if (value.uid || value.pwd || value.clientId) {
				this.panelProperty?.open();
			}
			this.security.certificateFileName = value.cert;
			this.security.privateKeyFileName = value.pkey;
			this.security.caCertificateFileName = value.caCert;
			if (value.cert || value.pkey || value.caCert) {
				this.panelCertificate?.open();
			}
		}
	}

    keyDownStopPropagation(event) {
        event.stopPropagation();
    }

	isWithPolling() {
		if (this.data.device?.type === DeviceType.internal) {
			return false;
		}
		if (this.appService.isClientApp || this.appService.isDemoApp) {
			return false;
		}
		return true;
	}

	canEnable() {
		if (this.isFuxaServer || this.data.device?.type === this.deviceType.internal) {
			return false;
		}
		return true;
	}

	onAddWriteKey() {
		this.redisOptions.customCommand.write.args.push({
			name: '',
			value: '',
		});
	}

	onRemoveWriteKey(idx: number) {
		this.redisOptions.customCommand.write.args.splice(idx, 1);
	}

	private securityModeToString(mode): string {
		let secMode = MessageSecurityMode;
		let result = '';
		if (mode === secMode.NONE) {
			this.translateService.get('device.security-none').subscribe((txt: string) => { result = txt; });
		} else if (mode === secMode.SIGN) {
			this.translateService.get('device.security-sign').subscribe((txt: string) => { result = txt; });
		} else if (mode === secMode.SIGNANDENCRYPT) {
			this.translateService.get('device.security-signandencrypt').subscribe((txt: string) => { result = txt; });
		}
		return result;
	}
}

interface DeviceSecurityGeneral {
	mode: string;
	gt: string;
	uid: string;
	pwd: string;
	clientId: string;
	cert: string;
	pkey: string;
	caCert: string;
}
