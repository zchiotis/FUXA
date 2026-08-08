import { Component, EventEmitter, Inject, OnDestroy, OnInit, Output } from '@angular/core';
import { AbstractControl, UntypedFormBuilder, UntypedFormGroup, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject, filter, take, takeUntil } from 'rxjs';
import { Device, Tag } from '../../../_models/device';
import { HmiService } from '../../../_services/hmi.service';
import { TranslateService } from '@ngx-translate/core';

@Component({
    selector: 'app-tag-property-edit-kawasaki',
    templateUrl: './tag-property-edit-kawasaki.component.html',
    styleUrls: ['./tag-property-edit-kawasaki.component.scss']
})
export class TagPropertyEditKawasakiComponent implements OnInit, OnDestroy {
    @Output() result = new EventEmitter<KawasakiTagResult>();

    private destroy$ = new Subject<void>();
    private existingAddresses = new Set<string>();
    existingNames: string[] = [];

    formGroup: UntypedFormGroup;
    definitions: KawasakiTagDefinition[] = [];
    selectedAddresses: string[] = [];
    filterText = '';
    loading = true;
    error: string;

    constructor(
        private fb: UntypedFormBuilder,
        private hmiService: HmiService,
        private translateService: TranslateService,
        public dialogRef: MatDialogRef<TagPropertyEditKawasakiComponent>,
        @Inject(MAT_DIALOG_DATA) public data: KawasakiTagDialogData
    ) { }

    ngOnInit() {
        Object.values(this.data.device.tags || {}).forEach((tag: Tag) => {
            if (tag.id !== this.data.tag?.id) {
                this.existingNames.push(tag.name);
                if (tag.address) {
                    this.existingAddresses.add(tag.address);
                }
            }
        });

        this.formGroup = this.fb.group({
            deviceName: [this.data.device.name, Validators.required],
            tagName: [this.data.tag?.name || '', [Validators.required, this.validateName()]],
            tagAddress: [this.data.tag?.address || '', Validators.required],
            tagType: [this.data.tag?.type || 'string', Validators.required],
            tagDescription: [this.data.tag?.description || '']
        });

        this.hmiService.onDeviceBrowse
            .pipe(takeUntil(this.destroy$), filter(res => !!res), take(1))
            .subscribe((res: any) => {
                this.definitions = (res?.result?.items || [])
                    .map((item: any) => ({
                        name: item.name || this.nameFromAddress(item.address),
                        label: item.label || item.address,
                        address: item.address,
                        type: item.type || 'string'
                    }))
                    .filter((item: KawasakiTagDefinition) => !!item.address)
                    .sort((a: KawasakiTagDefinition, b: KawasakiTagDefinition) => a.address.localeCompare(b.address));

                if (!this.data.checkToAdd && this.data.tag?.address && !this.definitions.some(item => item.address === this.data.tag.address)) {
                    this.definitions.unshift({
                        name: this.data.tag.name,
                        label: this.data.tag.description || this.data.tag.address,
                        address: this.data.tag.address,
                        type: this.data.tag.type || 'string'
                    });
                }
                this.loading = false;
            });

        this.hmiService.askDeviceBrowse(this.data.device.id, {});
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    get filteredDefinitions(): KawasakiTagDefinition[] {
        const value = this.filterText.trim().toLowerCase();
        if (!value) {
            return this.definitions;
        }
        return this.definitions.filter(item =>
            item.address.toLowerCase().includes(value) ||
            item.label.toLowerCase().includes(value) ||
            item.type.toLowerCase().includes(value));
    }

    get selectableDefinitions(): KawasakiTagDefinition[] {
        return this.filteredDefinitions.filter(item => !this.existingAddresses.has(item.address));
    }

    isExisting(address: string): boolean {
        return this.existingAddresses.has(address);
    }

    selectAllFiltered() {
        const addresses = this.selectableDefinitions.map(item => item.address);
        this.selectedAddresses = Array.from(new Set([...this.selectedAddresses, ...addresses]));
    }

    clearSelection() {
        this.selectedAddresses = [];
    }

    onAddressChanged(address: string) {
        const definition = this.definitions.find(item => item.address === address);
        if (definition) {
            this.formGroup.patchValue({ tagType: definition.type });
        }
    }

    validateName(): ValidatorFn {
        return (control: AbstractControl): ValidationErrors | null => {
            this.error = null;
            const name = control?.value;
            if (this.existingNames.includes(name)) {
                return { name: this.translateService.instant('msg.device-tag-exist') };
            }
            if (name?.includes('@')) {
                return { name: this.translateService.instant('msg.device-tag-invalid-char') };
            }
            return null;
        };
    }

    onOkClick() {
        if (this.data.checkToAdd) {
            const selected = this.definitions.filter(item => this.selectedAddresses.includes(item.address) && !this.isExisting(item.address));
            this.result.emit({ definitions: selected });
            return;
        }
        this.result.emit(this.formGroup.getRawValue());
    }

    onNoClick() {
        this.result.emit();
    }

    private nameFromAddress(address: string): string {
        return String(address || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
    }
}

export interface KawasakiTagDefinition {
    name: string;
    label: string;
    address: string;
    type: string;
}

export interface KawasakiTagDialogData {
    device: Device;
    tag: Tag;
    checkToAdd: boolean;
}

export interface KawasakiTagResult {
    definitions?: KawasakiTagDefinition[];
    tagName?: string;
    tagAddress?: string;
    tagType?: string;
    tagDescription?: string;
}
