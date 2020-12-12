'use strict';

let instructionStatusColumnNames = [
    'Instruction',
    'Issue',
    'Execute',
    'Write result'
];


// Make all functions automatically curryable..
Function.prototype.curry = function () {
    let slice = Array.prototype.slice,
        args = slice.apply(arguments),
        that = this;
    return function ( ) {
        return that.apply(null, args.concat(slice.apply(arguments)));
    };
};


function defined(v) {
    return typeof v !== 'undefined';
}


function heading(row, words, tooltip) {
    let heading = {'text': words};

    if (defined(tooltip)) {
        heading['title'] = tooltip;
        heading['class'] = 'mastertooltip';
    }
    $(row).append($('<th>', heading));
}


function newTable(kwargs) {
    let table = document.createElement('table');
    if (defined(kwargs['caption'])) {
        let table_caption = document.createElement('caption');
        table_caption.appendChild(document.createTextNode(kwargs['caption']));
        table.appendChild(table_caption);
    }
    if (defined(kwargs['id'])) {
        $(table).attr('id', kwargs['id']);
    }
    if (defined(kwargs['headings'])) {
        const tr = table.insertRow();
        _.map(kwargs['headings'], function(h) {
            heading.apply(heading, [tr].concat(h));
        });
    }
    return table;
}


function Address(register, offset) {
    let addr = {
        'register': register,
        'offset': offset,
        'toString': function() {
            if (defined(offset)) {
                let sign = offset < 0 ? ' - ' : ' + ';
                return 'Regs[' + register.toString() + ']'
                    + sign
                    + offset.toString();
            }
            return 'Regs[' + register.toString() + ']';
        }
    };
    return addr;
}


// An actual register.
class Register {
    constructor(name) {
        this.name = name;
        this.value = null;
    }
}


// A list of registers.
function RegisterFile() {
    this.name = 'RegisterFile';
    function regName(name, index) {
        return name + index.toString();
    }
    const registerNames = _.map(_.range(0, 16, 2), regName.curry('F')).concat(
        _.map(_.range(0, 8),     regName.curry('R')));

    let regfile = {};
    _.map(registerNames, function(name) {
        regfile[name] = new Register(name);
    });

    regfile['each'] = function*() {
        for (let name of registerNames) {
            yield regfile[name];
        }
    };
    return regfile;
}


function RegisterStat(registers) {
    let rs = {};
    let table = newTable({
        'caption': 'Register status',
        'id': 'RegisterStatus',
        'headings': ['Field'].concat(_.map(registers, function(r) { return r.name; })),
    });
    let tr = table.insertRow();
    heading(tr, 'Qi', 'Which reservation station will produce register contents');

    function makeStatusSlot(reg) {
        let Qi = null;
        let text = document.createTextNode('');
        let cell = tr.insertCell();
        cell.appendChild(text);
        let slot = {
            'name': reg.name,
            // Whether the status slot is full. The opposite of "available".
            'full': function() {
                return Qi !== null;
            },
            // Whether the status slot has no contents.
            'available': function() {
                return Qi === null;
            },
            toString: function() {
                return (Qi === null ? '' : Qi.toString());
            },
            'Qi': function(v) {
                if (typeof v === 'undefined') { return Qi; }
                Qi = v;
                $(cell).text(Qi === null ? '' : Qi.toString());
            },
        };
        slot.highlightSource = function() {
            if (slot.full())
                $(cell).addClass('sourceOccupied');
            else
                $(cell).addClass('source');
        };
        slot.highlightDestination = function() {
            if (slot.full())
                $(cell).toggleClass('destinationOccupied');
            else
                $(cell).toggleClass('destination');
        };
        slot.clearHighlights = function() {
            $(cell).attr('class', '');
        };
        $(cell).hover(function() {
            if (!slot.full()) return;
            $(slot.Qi()._row).find('td').each(function() {
                $(this).toggleClass('source');
            });
        });
        rs[reg.name] = slot;
        return slot;
    }

    const registerSlots = _.map(registers, makeStatusSlot);
    document.body.appendChild(table);
    rs.each = function*() { for (let r of registerSlots) yield r; };
    return rs;
}


function ExecutionUnit(tr, type, name, registerStatus) {

    function makeProperty(name, initialValue, hover) {
        let value = defined(initialValue) ? initialValue : null;
        let text = document.createTextNode(value === null ? '' : value.toString());
        let cell = tr.insertCell();
        cell.appendChild(text);
        if (defined(hover)) {
            $(cell).hover(hover.curry(name));
        }
        return function(v) {
            if (defined(v)) {
                $(cell).text(
                    (value = v) === null ? '' : v.toString());
            }
            return value;
        };
    }
    let object = {
        // Type of this execution unit.
        //
        // 'Load'  -> memory load
        // 'Add'   -> add/subtract
        // 'Mult'  -> mult/div
        // 'Store' -> memory store
        type: type,
        _row: tr,
        toString: function() { return name; },
        'Name': makeProperty('Name', name),
        'Busy': makeProperty('Busy', false),
        'Op': makeProperty('Op'),
        'Vj': makeProperty('Vj'),
        'Vk': makeProperty('Vk'),
    };

    function highlight(selector) {
        if (!object[selector]()) return;
        $(object[selector]()._row).find('td').each(function() {
            $(this).toggleClass('source');
        });
    }

    // TODO: Is there a way we can group instruction + instructionRow
    // so this doesn't have to be done separately?
    object.instruction = null;
    object.instructionRow = null;
    object.Qj = makeProperty('Qj', null, highlight);
    object.Qk = makeProperty('Qk', null, highlight);
    object.A = makeProperty('A', '');
    object.Result = makeProperty('Result');
    object.getSource = function(source) {
        if (source.full() && object.Qj()) {
            object.Qk(source.Qi());
        }
        else if (source.full()) {
            object.Qj(source.Qi());
        }
        else if (object.Vj()) {
            object.Vj(new Address(source.name));
        }
        else {
            object.Vk(new Address(source.name));
        }
    };
    object.issue = function(row, instruction) {
        if (object.Busy()) {
            return null;
        }
        object.instruction = instruction;
        object.instructionRow = row;
        object.Busy(true);
        object.Op(instruction.op);
        if (instruction.type === 'Store') {
            object.A(new Address(instruction.rd, instruction.offset));
            for (let source of instruction.wants()) {
                object.getSource(source);
            }
        }
        else {
            for (let source of instruction.wants()) {
                object.getSource(source);
            }
        }
        return object;
    };
    object.execute = function() {
        if (object.instruction.type === 'Load' && object.A() === '') {
            // Load step 1.
            //
            // Wait until RS[r].Qj = 0 & r is head of load-store queue:
            //
            //    RS[r].A <- RS[r].Vj + RS[r].A;
            //
            object.A(new Address(object.instruction.rs, object.instruction.offset));
            return;
        } else if (!object.instruction || object.Qj() || object.Qk() || !object.Busy()) {
            return null;
        }
        object.Vj(null);
        object.Vk(null);
        object.Result(true);
        return object;
    };

    // We are waiting on the execution unit if it is our Qi or Qj source.
    object.waitingOn = function(executionUnit) {
        // Shortcut the operation if Qi() or Qj() are null;
        if (null === object.Qj() || null === object.Qk())
            return false;
        return executionUnit === object.Qj() || executionUnit === object.Qk();
    };
    object.resolve = function(executionUnit) {
        if (executionUnit === object.Qj()) {
            object.Qj(null);
            object.Vj(true);
        }
        if (executionUnit === object.Qk()) {
            object.Qk(null);
            object.Vk(true);
        }
        return object;
    };
    object.clear = function() {
        object.instruction = null;
        object.instructionRow = null;
        object.A(null);
        object.Result(null);
        object.Op(null);
        object.Qj(null);
        object.Qk(null);
        object.Vj(null);
        object.Vk(null);
        object.Busy(false);
        _.each(registerStatus.each(), function(rs) {
            if (rs.Qi() === object)
                rs.Qi(null);
        });
        return object;
    };

    $(tr).hover(function() {
        if (object.instructionRow !== null) {
            let i = object.instructionRow['Instruction'];
            console.debug(object.instruction);
            object.instruction.destination().highlightDestination();
            $(i).toggleClass('source');
        }
    });

    return object;
}


// Construct a reservation station.
//
// Args:
//   registerStatus: the register status object.
let ReservationStation = function(registerStatus) {
    let object = {};

    let table = newTable({
        'caption': 'Reservation stations',
        'id': 'ReservationStations',
        'headings': [
            ['Name',   'Name of the execution unit'],
            ['Busy',   'Whether the unit is in use'],
            ['Op',     'Operation type'],
            ['Vj',     'j value'],
            ['Vk',     'k value'],
            ['Qj',     'j data source'],
            ['Qk',     'k data source'],
            ['A',      'Calculated address'],
            ['Result', 'Whether a final result has been produced'],
        ]
    });

    let executionUnits = [];

    function build_station(name, quantity) {
        return _.map(_.range(quantity), function(i) {
            let tr = table.insertRow();
            // i is the number of execution units already created of this
            // type. So the rowName is the execution unit type name along
            // with its number.
            let rowName = name + i.toString();
            let unit = new ExecutionUnit(tr, name, rowName, registerStatus);
            object[rowName] = unit;
            executionUnits.push(unit);
            return unit;
        });
    }

    let units = {
        'Load': build_station('Load', 2),
        'Add': build_station('Add', 3),
        'Mult': build_station('Mult', 2),
        'Store': build_station('Store', 2),
    };

    object.issue = function(row, instruction) {
        function busy(executionUnit) {
            return executionUnit.Busy();
        }
        let station = _.first(_.reject(units[instruction.type], busy));
        if (!station) return null;
        else station.issue(row, instruction);
        return station;
    };

    object.addTable = function() {
        document.body.appendChild(table);
    };

    object.each = function*() {
        for(let unit of executionUnits)
            yield unit;
    };

    object.writeBack = function(finishedUnit) {
        if (!finishedUnit.Busy()) {
            throw 'Execution Unit attempted writeback without instruction';
        }
        for(let unit of executionUnits) {
            unit.resolve(finishedUnit);
        }
        finishedUnit.clear();
        return finishedUnit;
    };

    return object;
};


function Assembler(registerStatus) {
    // R-type (register) instruction
    function RINST(op, type, rd, rs, rt) {
        return {
            'op': op,
            'type': type,
            'rd': rd,
            'rs': rs,
            'rt': rt,
            'toString': function() {
                return op + ' ' + rd + ',' + rs + ',' + rt;
            },
            'destination': function() {
                return registerStatus[rd];
            },
            'wants': function() {
                return [registerStatus[rs], registerStatus[rt]];
            },
        };
    }

    // I-type (immediate) instruction
    function IINST(op, type, rd, rs, offset) {
        if (type === 'Store') {
            let temp = rd;
            rd = rs;
            rs = temp;
        }
        return {
            'op': op,
            'type': type,
            'rd': rd,
            'rs': rs,
            'offset': offset,
            'toString': function() {
                if (type !== 'Store')
                    return op + ' ' + rd + ',' + offset.toString() + '(' + rs + ')';
                else
                    return op + ' ' + rs + ',' + offset.toString() + '(' + rd + ')';
            },
            'destination': function() {
                return registerStatus[rd];
            },
            'wants': function() {
                return [registerStatus[rs]];
            },
        };
    }

    return {
        'LD': IINST.curry('L.D').curry('Load'),
        'SUBD': RINST.curry('SUB.D').curry('Add'),
        'ADDD': RINST.curry('ADD.D').curry('Add'),
        'MULD': RINST.curry('MUL.D').curry('Mult'),
        'DIVD': RINST.curry('DIV.D').curry('Mult'),
        'SD': IINST.curry('S.D').curry('Store'),
    };
}


let InstructionStatus = function(reservationStation, table, instruction) {
    let object = {};
    instruction['status'] = object;

    object['issue'] = function(row, instruction) {
        let reserved = reservationStation.issue(row, instruction);
        if (reserved) {
            instruction.destination().Qi(reserved);
            row['Issue'].text('true');
        }
        return reserved;
    };
    object['execute'] = function (row, executionUnit) {
        let executed = executionUnit.execute();
        if (executed) {
            row['Execute'].text('true');
        }
        return executed;
    };
    object['writeResult'] = function (row, executionUnit, instruction) {
        let wrote = reservationStation.writeBack(executionUnit);
        console.log(wrote);
        if (wrote) {
            if (instruction.destination().Qi() === executionUnit) {
                instruction.destination().Qi(null);
            }
            row['Write result'].text('true');
            executionUnit = null;
        }
        return wrote;
    };

    let tr = table.insertRow();
    let row = {};
    let executionUnit = null;
    _.each(instructionStatusColumnNames, function addColumn(colName) {
        return row[colName] = $(tr.insertCell()).text('');
    });

    object.addHighlights = function () {
        $(this).addClass('highlight');
        if (!row['Issue'].text()) {
            instruction.destination().highlightDestination();
            for (let source of instruction.wants()) {
                source.highlightSource();
            }
        }
    };

    object.clearHighlights = function() {
        $(this).removeClass('highlight');
        instruction.destination().clearHighlights();
        for (let source of instruction.wants()) {
            source.clearHighlights();
        }
    };

    row['Instruction'].hover(object.addHighlights, object.clearHighlights);

    row['Instruction'].text(instruction.toString()).click(function() {
        if ('true' === row['Write result'].text()) {
            return;
        }
        else if ('true' === row['Execute'].text()) {
            if(object.writeResult(row, executionUnit, instruction))
                object.executionUnit = null;
        }
        else if ('true' === row['Issue'].text()) {
            object.execute(row, executionUnit);
        }
        else {
            executionUnit = object.issue(row, instruction);
        }
        object.clearHighlights();
    });

    return object;
};


let InstructionStatusTable = function(reservationStation) {
    let table = newTable({
        'caption': 'Instruction Status',
        'id': 'InstructionStatus',
        'headings': instructionStatusColumnNames,
    });

    document.body.appendChild(table);

    let object = {
        'read': function(instruction) {
            new InstructionStatus(reservationStation,
                table,
                instruction);
        },
    };
    return object;
};


$(function(){
    let regs = new RegisterFile();
    let registerStat = new RegisterStat(regs);
    let rs = new ReservationStation(registerStat);
    let is = new InstructionStatusTable(rs);
    rs.addTable();

    $('.mastertooltip').hover(function(){
        // Hover over code
        let title = $(this).attr('title');
        $(this).data('tipText', title).removeAttr('title');
        $('<p>', {
            'text': title,
            'class': 'tooltip',
        }).appendTo('body').fadeIn('slow');
    }, function() {
        // Hover out code
        $(this).attr('title', $(this).data('tipText'));
        $('.tooltip').remove().fadeOut('fast');
    }).mousemove(function(e) {
        let mousex = e.pageX + 16; //Get X coordinates
        let mousey = e.pageY - 32; //Get Y coordinates
        $('.tooltip')
            .css({ top: mousey , left: mousex });
    });

    let asm = new Assembler(registerStat);
    // is.read(asm.LD('F0', 'R1', 0));
    // is.read(asm.MULD('F4', 'F0', 'F2'));
    // is.read(asm.SD('F4', 'R1', 0));
    // is.read(asm.LD('F0', 'R1', 8));
    // is.read(asm.MULD('F4', 'F0', 'F2'));
    // is.read(asm.SD('F4', 'R1', 0));
    is.read(asm.LD  ('F6',  'R2', 32));
    is.read(asm.LD  ('F2',  'R3', 44));
    is.read(asm.MULD('F0',  'F2', 'F4'));
    is.read(asm.ADDD('F10', 'F12','F8'));
    is.read(asm.SUBD('F8',  'F2', 'F6'));
    is.read(asm.DIVD('F10', 'F0', 'F6'));
    is.read(asm.ADDD('F6',  'F8', 'F2'));
    is.read(asm.SD  ('F6',  'R2', 32));
});
