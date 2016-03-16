/// <reference path="../../base/references.d.ts"/>
declare var _;

import { TimeScale, TimeScaleDataItem } from "./TimeScale";

import { VisualBase } from "../../base/VisualBase";
import { default as Utils, Visual } from "../../base/Utils";
import IVisual = powerbi.IVisual;
import DataViewTable = powerbi.DataViewTable;
import IVisualHostServices = powerbi.IVisualHostServices;
import VisualCapabilities = powerbi.VisualCapabilities;
import VisualInitOptions = powerbi.VisualInitOptions;
import VisualUpdateOptions = powerbi.VisualUpdateOptions;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import VisualObjectInstance = powerbi.VisualObjectInstance;
import DataView = powerbi.DataView;
import SelectionId = powerbi.visuals.SelectionId;
import SelectionManager = powerbi.visuals.utility.SelectionManager;
import VisualDataRoleKind = powerbi.VisualDataRoleKind;
import SQExpr = powerbi.data.SQExpr;

@Visual(require("./build.js").output.PowerBI)
export default class TimeScaleVisual extends VisualBase implements IVisual {

    private host : IVisualHostServices;
    private timeColumnIdentity: SQExpr;
    private timeScale: TimeScale;

    /**
     * The set of capabilities for the visual
     */
    public static capabilities: VisualCapabilities = $.extend(true, {}, VisualBase.capabilities, {
        dataRoles: [{
            name: 'Times',
            kind: VisualDataRoleKind.Grouping,
            displayName: "Time"
        }, {
            name: 'Values',
            kind: VisualDataRoleKind.Measure,
            displayName: "Values"
        }],
        dataViewMappings: [{
            categorical: {
                categories: {
                    for: { in: 'Times' },
                    dataReductionAlgorithm: { top: {} }
                },
                values: {
                    select: [{ bind: { to: 'Values' } }]
                }
            },
        }],
        objects: {
            general: {
                displayName: powerbi.data.createDisplayNameGetter('Visual_General'),
                properties: {
                    filter: {
                        type: { filter: {} },
                        rule: {
                            output: {
                                property: 'selected',
                                selector: ['Time'],
                            }
                        }
                    },
                },
            }
        }
    });

    /**
     * The template for the grid
     */
    private template: string = `
        <div>
            <div class="timescale"></div>
        </div>
    `;
    
    /**
     * Compares the ids of the two given items
     */
    private idCompare = (a : TimeScaleVisualDataItem, b: TimeScaleVisualDataItem) => a.identity.equals(b.identity);
    
    /**
     * Constructor for the timescale visual
     */
    constructor(private noCss = false) {
        super();
    }

    /** This is called once when the visual is initialially created */
    public init(options: VisualInitOptions): void {
        super.init(options);
        this.element.append($(this.template));
        this.host = options.host;
        this.timeScale = new TimeScale(this.element.find(".timescale"), { width: options.viewport.width, height: options.viewport.height });
        this.timeScale.events.on("rangeSelected", (range) => this.onTimeRangeSelected(range));
    }

    /** Update is called for data updates, resizes & formatting changes */
    public update(options: VisualUpdateOptions) {
        super.update(options);

        var startDate;
        var endDate;
        var dataView = options.dataViews && options.dataViews[0];
        if (dataView) {
            var dataViewCategorical = dataView.categorical;
            var data = TimeScaleVisual.converter(dataView);

            // Stash this bad boy for later, so we can filter the time column
            if (dataViewCategorical && dataViewCategorical.categories) {
                this.timeColumnIdentity = dataViewCategorical.categories[0].identityFields[0];
            }

            var item: any = dataView.metadata.objects;
            if (dataView.metadata.objects && item.general && item.general.filter
                && item.general.filter.whereItems && item.general.filter.whereItems[0]
                && item.general.filter.whereItems && item.general.filter.whereItems[0].condition) {
                var filterStartDate = item.general.filter.whereItems[0].condition.lower.value;
                var filterEndDate = item.general.filter.whereItems[0].condition.upper.value;
                startDate = new Date(filterStartDate.getTime());
                endDate = new Date(filterEndDate.getTime());

                // If the selection has changed at all, then set it
                var currentSelection = this.timeScale.selectedRange;
                if (!currentSelection ||
                    currentSelection.length !== 2 ||
                    startDate !== currentSelection[0] ||
                    endDate !== currentSelection[1]) {
                    this.timeScale.selectedRange = [startDate, endDate];
                }
            }

            // If the data has changed at all, then update the timeScale
            if (Utils.hasDataChanged(data, <TimeScaleVisualDataItem[]>this.timeScale.data, this.idCompare)) {
                this.timeScale.data = data;
            }

            // If the dimensions changed
            if (!_.isEqual(this.timeScale.dimensions, options.viewport)) {
                this.timeScale.dimensions = { width: options.viewport.width, height: options.viewport.height };
            }
        }
    }

    /**
     * Converts the data view into a time scale
     */
    public static converter(dataView : DataView) : TimeScaleVisualDataItem[] {
        var items : TimeScaleVisualDataItem[];
        var dataViewCategorical = dataView && dataView.categorical;

        // Must be two columns: times and values
        if (dataViewCategorical &&
            dataViewCategorical.categories &&
            dataViewCategorical.categories.length === 1 &&
            dataViewCategorical.values && dataViewCategorical.values.length) {
            items = dataViewCategorical.categories[0].values.map((date, i) => {
                return {
                    date: TimeScaleVisual.coerceDate(date),
                    value: dataViewCategorical.values[0].values[i],
                    identity: SelectionId.createWithId(dataViewCategorical.categories[0].identity[i])
                };
            })
        }
        return items;
    }
    
    /**
     * Coerces the given date value into a date object
     */
    public static coerceDate(dateValue: any) : Date {
        if (!dateValue) {
            dateValue = new Date();
        }
            
        if (typeof dateValue === "string") {
            dateValue = new Date((Date.parse(dateValue) + ((new Date().getTimezoneOffset() + 60) * 60 * 1000)))
        }
        
        // Assume it is just a year
        if (dateValue > 31 && dateValue <= 10000) {
            dateValue = new Date(dateValue, 0);
        } else if (dateValue >= 0 && dateValue <= 31) {
            dateValue = new Date(new Date().getFullYear(), 1, dateValue);
        } else if (typeof dateValue === "number" && dateValue > 10000) {
            // Assume epoch
            dateValue = new Date(dateValue);
        }
        return dateValue;
    }

    /**
     * Raised when the time range is selected
     * @param range undefined means no range, otherwise should be [startDate, endDate]
     */
    private onTimeRangeSelected(range: Date[]) {
        var filter;
        if (range && range.length === 2) {
            var filterExpr = powerbi.data.SQExprBuilder.between(
                this.timeColumnIdentity,
                powerbi.data.SQExprBuilder.dateTime(range[0]),
                powerbi.data.SQExprBuilder.dateTime(range[1]));
            filter = powerbi.data.SemanticFilter.fromSQExpr(filterExpr);
        }
        var objects: powerbi.VisualObjectInstancesToPersist = {
            merge: [
                <VisualObjectInstance>{
                    objectName: "general",
                    selector: undefined,
                    properties: {
                        "filter": filter
                    }
                }
            ]
        };

        this.host.persistProperties(objects);

        // Hack from timeline.ts
        this.host.onSelect({ data: [] });
    }

    /**
     * Gets the inline css used for this element
     */
    protected getCss() : string[] {
        return this.noCss ? [] : super.getCss().concat([require("!css!sass!./css/TimeScaleVisual.scss")]);
    }
}

/**
 * The data item used by the TimeScaleVisual
 */
interface TimeScaleVisualDataItem extends TimeScaleDataItem {

    /**
     * The identity for this individual selection item
     */
    identity: SelectionId;
}